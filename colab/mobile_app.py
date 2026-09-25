"""スマホ向けの Qwen-Image-2.1 生成画面。

Colab の VM 内で ComfyUI の API を叩きます。画面とのやりとりは 2 通り:
- Colab のセル出力に画面を表示し、google.colab.kernel.invokeFunction で呼ぶ（register_colab）。
  ポート転送を通らないので、iPhone の Safari でも表示される
- 小さな Web サーバーとして動かし、ポート転送（proxyPort）で開く（__main__）
画像は VM の ComfyUI/output にだけ置き、ドライブやフォトには保存しません。
"""
import argparse
import base64
import io
import json
import os
import random
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# --- workflow ---
def build_workflow(prompt, negative, width, height, steps, seed, text_mode, switch_step, cfg_text, dit, te, vae, loras=(),
                   refs=(), ref_resolution=1024):
    # refs に ComfyUI/input 内の画像名を渡すと編集モード。出力サイズは 1 枚目の参照画像の縦横比で決まり、
    # width/height にはその大きさ（ref_size() で計算）を渡す
    wf = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": dit}},
        # 公式スケジューラと同じく解像度に応じて shift を変える（base 0.5 @256 トークン、傾き 0.4/7936）。
        # ComfyUI の既定は 1024x1024 相当の 0.69 固定で、高解像度では構図が崩れやすい。
        # ModelSamplingFlux は 4096 トークンで max_shift に達する式なので、同じ傾きになる 0.6935 を渡す
        "10": {"class_type": "ModelSamplingFlux", "inputs": {
            "model": ["1", 0], "max_shift": 0.6935, "base_shift": 0.5, "width": width, "height": height}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": te, "type": "qwen_image", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae}},
        "4": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["2", 0], "prompt": prompt, "negative_prompt": negative, "resolution": 1024}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
    }
    # LoRA は DiT の読み込み直後に順に重ねる（(ファイル名, 強さ) のリスト）
    model = ["1", 0]
    for i, (name, strength) in enumerate(loras):
        wf[str(11 + i)] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": model, "lora_name": name, "strength_model": strength}}
        model = [str(11 + i), 0]
    wf["10"]["inputs"]["model"] = model
    latent = ["5", 0]
    if refs:
        enc = wf["4"]["inputs"]
        enc["vae"] = ["3", 0]
        enc["resolution"] = ref_resolution
        for i, name in enumerate(refs):
            wf[str(20 + i)] = {"class_type": "LoadImage", "inputs": {"image": name}}
            enc[f"images.image_{i + 1}"] = [str(20 + i), 0]
        # 参照画像に合わせた空の latent（TextEncodeQwenImage21 の 3 番目の出力）を使う
        del wf["5"]
        latent = ["4", 2]
    def ksampler(add_noise, cfg, start, end, leftover, latent):
        return {"class_type": "KSamplerAdvanced", "inputs": {
            "model": ["10", 0], "add_noise": add_noise, "noise_seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": "euler", "scheduler": "simple",
            "positive": ["4", 0], "negative": ["4", 1], "latent_image": latent,
            "start_at_step": start, "end_at_step": end, "return_with_leftover_noise": leftover}}
    if text_mode:
        # 前半 cfg 1.0 で構図を決め、後半 cfg 3.0 ＋ネガティブで文字を描き直す
        wf["6"] = ksampler("enable", 1.0, 0, switch_step, "enable", latent)
        wf["7"] = ksampler("disable", cfg_text, switch_step, 10000, "disable", ["6", 0])
        last = "7"
    else:
        wf["6"] = ksampler("enable", 1.0, 0, 10000, "disable", latent)
        last = "6"
    wf["8"] = {"class_type": "VAEDecode", "inputs": {"samples": [last, 0], "vae": ["3", 0]}}
    wf["9"] = {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "qwen21"}}
    return wf


def ref_size(width, height, resolution):
    # TextEncodeQwenImage21 と同じ計算: 面積 resolution^2 に近く、縦横比を保った 32 の倍数
    import math
    ratio = width / height
    w = round(math.sqrt(resolution * resolution * ratio) / 32) * 32
    h = round(math.sqrt(resolution * resolution / ratio) / 32) * 32
    return max(32, w), max(32, h)
# --- end workflow ---

# 公式の推奨解像度（約 4MP）。高速モードは縦横それぞれ半分（約 1MP）
SIZES = {
    "1:1": (2048, 2048),
    "3:4": (1792, 2400),
    "4:3": (2400, 1792),
    "2:3": (1696, 2528),
    "3:2": (2528, 1696),
    "9:16": (1536, 2752),
    "16:9": (2752, 1536),
}
# (解像度の倍率, ステップ数)。公式の既定は 40 ステップ
QUALITY = {"high": (1.0, 40), "fast": (0.5, 25)}
IMAGE_NAME = re.compile(r"^qwen21_\d+_\.png$")
REF_NAME = re.compile(r"^qref_[0-9a-f]{12}\.png$")
MAX_REFS = 3

PAGE = r"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Qwen Image</title>
<style>
:root {
  --bg: #f6f6f4; --card: #ffffff; --text: #1d1d1b; --muted: #6b6b66; --line: #deded8;
  --accent: #2f5bd3; --accent-text: #ffffff; --error: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141413; --card: #1f1f1d; --text: #ececea; --muted: #a0a09a; --line: #34342f;
    --accent: #7c9cff; --accent-text: #0d1330; --error: #ff8a80;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", sans-serif;
}
main { max-width: 640px; margin: 0 auto; padding: 16px 16px 48px; }
h1 { font-size: 20px; margin: 4px 0 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 16px; }
label { display: block; font-size: 14px; color: var(--muted); margin: 0 0 6px; }
textarea, input[type=number] {
  width: 100%; font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
}
textarea { min-height: 110px; resize: vertical; }
select {
  width: 100%; font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px;
}
.slider { display: flex; align-items: center; gap: 12px; margin-top: 10px; }
.slider input { flex: 1; accent-color: var(--accent); }
.slider span { font-variant-numeric: tabular-nums; min-width: 3em; text-align: right; }
.slider.off { opacity: .4; }
.row.off { opacity: .4; pointer-events: none; }
.refs { display: flex; flex-wrap: wrap; gap: 10px; }
.ref { position: relative; }
.ref img { width: 76px; height: 76px; object-fit: cover; border-radius: 10px; display: block; border: 1px solid var(--line); }
.ref button {
  position: absolute; top: -8px; right: -8px; width: 26px; height: 26px; border-radius: 50%;
  border: 0; background: var(--text); color: var(--bg); font-size: 15px; line-height: 26px; padding: 0;
}
.addref {
  display: inline-flex; align-items: center; justify-content: center; width: 76px; height: 76px;
  border: 1.5px dashed var(--line); border-radius: 10px; color: var(--accent); font-size: 13px; text-align: center;
}
.result .actions { display: flex; gap: 16px; }
.row { margin-top: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chips button {
  font: inherit; font-size: 14px; padding: 6px 12px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--bg); color: var(--text);
}
.chips button[aria-pressed=true] { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.toggle { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.toggle input { width: 22px; height: 22px; }
.hint { font-size: 13px; color: var(--muted); margin: 4px 0 0; }
details summary { cursor: pointer; color: var(--muted); font-size: 14px; }
#go {
  width: 100%; margin-top: 16px; padding: 14px; font: inherit; font-weight: 600; font-size: 17px;
  border: 0; border-radius: 12px; background: var(--accent); color: var(--accent-text);
}
#go:disabled { opacity: .5; }
#status { min-height: 1.5em; margin: 12px 0 0; color: var(--muted); font-size: 14px; }
#status.error { color: var(--error); }
.result img { width: 100%; border-radius: 10px; display: block; }
.result .meta { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 13px; color: var(--muted); }
.result a { color: var(--accent); font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
  <h1>Qwen-Image-2.1</h1>

  <div class="card">
    <label for="prompt">プロンプト</label>
    <textarea id="prompt" placeholder="例：夕暮れの市役所の窓口、温かい照明、「市民課」と書かれた木の看板"></textarea>

    <div class="row">
      <label>参照画像（同じキャラクターでポーズや場面を変えるとき）</label>
      <div class="refs">
        <div class="refs" id="refs"></div>
        <label class="addref" id="addref">＋<br>画像を追加<input type="file" id="ref_file" accept="image/*" hidden></label>
      </div>
      <p class="hint">追加すると編集モードになります。プロンプトには変えたい内容を書きます（例：同じ女性が公園のベンチに座って本を読んでいる、全身）。出力は 1 枚目の縦横比になります。最大 3 枚</p>
    </div>

    <div class="row" id="size_row">
      <label>縦横比</label>
      <div class="chips" id="sizes"></div>
    </div>

    <div class="row">
      <label>画質</label>
      <div class="chips" id="quality"></div>
      <p class="hint">標準は公式の推奨設定（約 400 万画素・40 ステップ）。人物や手はこちらで。高速は約 100 万画素・25 ステップで、崩れやすくなります</p>
    </div>

    <div class="row toggle">
      <div>
        <div>文字入りモード</div>
        <p class="hint">看板やポスターの文字をくっきりさせます</p>
      </div>
      <input type="checkbox" id="text_mode">
    </div>

    <div class="row" id="lora_row">
      <label for="lora">LoRA</label>
      <select id="lora"><option value="">使わない</option></select>
      <div class="slider">
        <input type="range" id="lora_strength" min="0" max="1.5" step="0.05" value="0.8">
        <span id="lora_strength_value">0.80</span>
      </div>
      <p class="hint" id="lora_hint">ノートブックのセル 3b で追加した LoRA を選べます</p>
    </div>

    <details class="row">
      <summary>詳細設定</summary>
      <div class="row">
        <label for="negative">ネガティブプロンプト（文字入りモードのときだけ効きます）</label>
        <textarea id="negative" style="min-height:60px">oversaturated, overexposed, gibberish text</textarea>
      </div>
      <div class="row">
        <label for="seed">シード（空欄でランダム）</label>
        <input type="number" id="seed" inputmode="numeric" min="0">
      </div>
    </details>

    <button id="go">生成する</button>
    <p id="status" role="status"></p>
  </div>

  <div id="results"></div>
</main>
<script>
function chips(id, options, initial) {
  const el = document.getElementById(id);
  let value = initial;
  for (const [key, label] of options) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.dataset.key = key;
    b.setAttribute("aria-pressed", key === value);
    b.onclick = () => {
      value = key;
      for (const x of el.children) x.setAttribute("aria-pressed", x.dataset.key === key);
    };
    el.appendChild(b);
  }
  return () => value;
}
const getSize = chips("sizes", ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"].map(s => [s, s]), "3:4");
const getQuality = chips("quality", [["high", "標準（高品質）"], ["fast", "高速"]], "high");

// 参照画像: {name: サーバー上の名前, thumb: JPEG の base64}
let refs = [];
const MAX_REFS = 3;
const refsEl = document.getElementById("refs");
function renderRefs() {
  refsEl.replaceChildren(...refs.map((r, i) => {
    const d = document.createElement("div");
    d.className = "ref";
    const img = document.createElement("img");
    img.src = "data:image/jpeg;base64," + r.thumb; img.alt = `参照画像 ${i + 1}`;
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", `参照画像 ${i + 1} を外す`);
    x.onclick = () => { refs.splice(i, 1); renderRefs(); };
    d.append(img, x);
    return d;
  }));
  document.getElementById("addref").style.display = refs.length >= MAX_REFS ? "none" : "";
  document.getElementById("size_row").classList.toggle("off", refs.length > 0);
}
function addRef(r) {
  if (refs.length >= MAX_REFS) refs.shift();
  refs.push(r);
  renderRefs();
}
async function downscale(file) {
  // スマホの写真は大きいので、送る前に長辺 2048 の JPEG に縮める
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ng) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ng(new Error("画像を読み込めませんでした"));
      i.src = url;
    });
    const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.92);
  } finally {
    URL.revokeObjectURL(url);
  }
}
const fileEl = document.getElementById("ref_file");
fileEl.onchange = async () => {
  const f = fileEl.files[0];
  fileEl.value = "";
  if (!f) return;
  setStatus("参照画像を送信中…");
  try {
    addRef(await call("upload_ref", {data: await downscale(f)}));
    setStatus("");
  } catch (e) {
    setStatus("参照画像を追加できませんでした：" + e.message, true);
  }
};

const loraEl = document.getElementById("lora");
const strengthEl = document.getElementById("lora_strength");
const strengthRow = strengthEl.parentElement;
function syncLora() {
  document.getElementById("lora_strength_value").textContent = Number(strengthEl.value).toFixed(2);
  strengthEl.disabled = !loraEl.value;
  strengthRow.classList.toggle("off", !loraEl.value);
}
strengthEl.oninput = syncLora;
loraEl.onchange = syncLora;
syncLora();
// Colab のセル出力の中ではカーネルを直接呼び、単独の Web ページでは HTTP で呼ぶ
const COLAB = !!(window.google && google.colab && google.colab.kernel);
async function call(op, payload = {}) {
  let data;
  if (COLAB) {
    const r = await google.colab.kernel.invokeFunction("qwen21.call", [op, payload], {});
    data = r.data["application/json"];
  } else {
    const res = await fetch("api/" + op, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload)});
    data = await res.json();
  }
  if (!data || data.error) throw new Error((data && data.error) || "応答がありません");
  return data;
}

call("loras").then(({loras}) => {
  for (const name of loras) loraEl.add(new Option(name.replace(/\.safetensors$/, ""), name));
  if (!loras.length) document.getElementById("lora_hint").textContent = "LoRA はまだありません（ノートブックのセル 3b で追加できます）";
}).catch(() => {});

const go = document.getElementById("go");
const statusEl = document.getElementById("status");
function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = isError ? "error" : "";
}

go.onclick = async () => {
  const prompt = document.getElementById("prompt").value.trim();
  if (!prompt) { setStatus("プロンプトを入力してください", true); return; }
  const seedText = document.getElementById("seed").value.trim();
  go.disabled = true;
  const t0 = Date.now();
  let timer;
  try {
    const job = await call("generate", {
      prompt, size: getSize(), quality: getQuality(),
      negative: document.getElementById("negative").value,
      text_mode: document.getElementById("text_mode").checked,
      seed: seedText === "" ? null : Number(seedText),
      lora: loraEl.value || null, lora_strength: Number(strengthEl.value),
      refs: refs.map(r => r.name),
    });
    let label = "送信しました";
    timer = setInterval(() => setStatus(`${label}… ${Math.round((Date.now() - t0) / 1000)} 秒`), 1000);
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      const st = await call("status", {id: job.prompt_id});
      if (st.state === "queued") label = `順番待ち（${st.position} 番目）`;
      else if (st.state === "running") label = "生成中（初回はモデルの読み込みで数分、標準画質は 1 枚数分かかります）";
      else if (st.state === "error") throw new Error(st.error);
      else if (st.state === "done") { await showResult(st.image, job.seed, job.lora, job.refs, prompt, (Date.now() - t0) / 1000); break; }
    }
    setStatus(`完了（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  } catch (e) {
    setStatus("エラー：" + e.message, true);
  } finally {
    clearInterval(timer);
    go.disabled = false;
  }
};

async function showResult(name, seed, lora, nrefs, prompt, secs) {
  // 表示は縮小 JPEG、保存するときだけ元の PNG を取りに行く
  const {jpeg} = await call("preview", {name});
  const card = document.createElement("div");
  card.className = "card result";
  const img = document.createElement("img");
  img.src = "data:image/jpeg;base64," + jpeg; img.alt = prompt;
  const meta = document.createElement("div");
  meta.className = "meta";
  const info = document.createElement("span");
  info.textContent = `seed ${seed}${nrefs ? ` ・ 参照 ${nrefs} 枚` : ""}${lora ? " ・ LoRA " + lora : ""} ・ ${Math.round(secs)} 秒`;
  const use = document.createElement("a");
  use.href = "#"; use.textContent = "参照に使う";
  use.onclick = async (ev) => {
    ev.preventDefault();
    try {
      addRef(await call("ref_from_output", {name}));
      setStatus("参照画像に追加しました。プロンプトを変えて生成できます");
      document.getElementById("prompt").scrollIntoView({behavior: "smooth", block: "center"});
    } catch (e) {
      setStatus("参照に追加できませんでした：" + e.message, true);
    }
  };
  const dl = document.createElement("a");
  dl.href = "#"; dl.textContent = "ファイルに保存";
  dl.onclick = async (ev) => {
    ev.preventDefault();
    const label = dl.textContent;
    dl.textContent = "準備中…";
    try {
      const {png} = await call("png", {name});
      const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], {type: "image/png"}));
      const a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setStatus("保存できませんでした：" + e.message, true);
    } finally {
      dl.textContent = label;
    }
  };
  const actions = document.createElement("span");
  actions.className = "actions";
  actions.append(use, dl);
  meta.append(info, actions);
  card.append(img, meta);
  document.getElementById("results").prepend(card);
}
</script>
</body>
</html>
"""


class App:
    """画面からの呼び出し（op, payload）を ComfyUI への操作に変換する。エラーは {"error": ...} で返す"""

    def __init__(self, args):
        self.args = args
        # 参照画像は ComfyUI/input に置く（LoadImage が読む場所）
        self.input_dir = getattr(args, "input", None) or os.path.join(os.path.dirname(args.output), "input")

    def comfy(self, path, data=None):
        req = urllib.request.Request(
            self.args.comfy + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json"})
        try:
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(e.read().decode()[:500]) from None

    def loras(self):
        if not os.path.isdir(self.args.loras):
            return []
        return sorted(f for f in os.listdir(self.args.loras) if f.endswith(".safetensors"))

    def image_path(self, name):
        if not IMAGE_NAME.match(str(name)):
            raise ValueError("bad name")
        return os.path.join(self.args.output, name)

    def call(self, op, payload=None):
        payload = payload or {}
        try:
            if op == "loras":
                return {"loras": self.loras()}
            if op == "generate":
                return self.generate(payload)
            if op == "status":
                return self.status(str(payload.get("id", "")))
            if op == "preview":
                return {"jpeg": self.preview(payload.get("name"))}
            if op == "upload_ref":
                data = str(payload.get("data", ""))
                return self.save_ref(base64.b64decode(data.split(",", 1)[-1]))
            if op == "ref_from_output":
                with open(self.image_path(payload.get("name")), "rb") as f:
                    return self.save_ref(f.read())
            if op == "png":
                with open(self.image_path(payload.get("name")), "rb") as f:
                    return {"png": base64.b64encode(f.read()).decode()}
            return {"error": f"unknown op: {op}"}
        except Exception as e:
            return {"error": str(e)}

    def save_ref(self, raw):
        """アップロードされた画像を検証して PNG で保存する（EXIF などは捨て、長辺 2048 に抑える）"""
        import uuid
        from PIL import Image, ImageOps
        if len(raw) > 30_000_000:
            raise ValueError("画像が大きすぎます")
        try:
            img = Image.open(io.BytesIO(raw))
            img = ImageOps.exif_transpose(img).convert("RGB")
        except Exception:
            raise ValueError("画像として読み込めませんでした") from None
        img.thumbnail((2048, 2048))
        os.makedirs(self.input_dir, exist_ok=True)
        name = f"qref_{uuid.uuid4().hex[:12]}.png"
        img.save(os.path.join(self.input_dir, name))
        thumb = img.copy()
        thumb.thumbnail((256, 256))
        buf = io.BytesIO()
        thumb.save(buf, "JPEG", quality=85)
        return {"name": name, "thumb": base64.b64encode(buf.getvalue()).decode(), "size": list(img.size)}

    def preview(self, name):
        from PIL import Image
        img = Image.open(self.image_path(name)).convert("RGB")
        img.thumbnail((1600, 1600))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=90)
        return base64.b64encode(buf.getvalue()).decode()

    def generate(self, body):
        prompt = str(body.get("prompt", "")).strip()
        if not prompt:
            raise ValueError("プロンプトが空です")
        width, height = SIZES.get(body.get("size"), SIZES["1:1"])
        scale, steps = QUALITY.get(body.get("quality"), QUALITY["high"])
        width, height = int(width * scale), int(height * scale)
        refs = [str(r) for r in (body.get("refs") or [])][:MAX_REFS]
        ref_resolution = int(2048 * scale)
        for r in refs:
            if not REF_NAME.match(r) or not os.path.exists(os.path.join(self.input_dir, r)):
                raise ValueError("参照画像が見つかりません。もう一度追加してください")
        if refs:
            from PIL import Image
            with Image.open(os.path.join(self.input_dir, refs[0])) as im:
                width, height = ref_size(*im.size, ref_resolution)
        seed = body.get("seed")
        seed = random.randint(0, 2**32 - 1) if seed is None else int(seed)
        lora = body.get("lora")
        if lora and lora not in self.loras():
            raise ValueError(f"LoRA が見つかりません: {lora}")
        strength = min(max(float(body.get("lora_strength", 0.8)), 0.0), 2.0)
        a = self.args
        wf = build_workflow(prompt, str(body.get("negative", "")), width, height, steps, seed,
                            # 文字入りモードは前半 6 割を cfg 1.0、残りを cfg_text で
                            bool(body.get("text_mode")), round(steps * 0.6), a.cfg_text,
                            a.dit, a.te, a.vae, [(lora, strength)] if lora else [], refs, ref_resolution)
        pid = self.comfy("/prompt", {"prompt": wf})["prompt_id"]
        return {"prompt_id": pid, "seed": seed, "refs": len(refs),
                "lora": f"{lora.removesuffix('.safetensors')} ×{strength:g}" if lora else None}

    def status(self, pid):
        h = self.comfy(f"/history/{urllib.parse.quote(pid)}")
        if pid not in h:
            q = self.comfy("/queue")
            if any(item[1] == pid for item in q.get("queue_running", [])):
                return {"state": "running"}
            pending = sorted(q.get("queue_pending", []), key=lambda item: item[0])
            for i, item in enumerate(pending):
                if item[1] == pid:
                    return {"state": "queued", "position": i + 1}
            return {"state": "running"}
        st = h[pid]["status"]
        if st.get("status_str") != "success":
            for kind, msg in st.get("messages", []):
                if kind == "execution_error":
                    return {"state": "error", "error": f"{msg['node_type']}: {msg['exception_message']}"}
            return {"state": "error", "error": "生成に失敗しました（ログ確認セルを見てください）"}
        img = h[pid]["outputs"]["9"]["images"][0]
        return {"state": "done", "image": img["filename"]}


def register_colab(app):
    """Colab のセルから呼ぶ。画面の invokeFunction("qwen21.call") を app.call につなぐ"""
    from google.colab import output
    from IPython.display import JSON
    output.register_callback("qwen21.call", lambda op, payload: JSON(app.call(op, payload)))


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json"):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if urllib.parse.urlparse(self.path).path == "/":
                self.send(200, PAGE.encode(), "text/html; charset=utf-8")
            else:
                self.send(404, {"error": "not found"})

        def do_POST(self):
            path = urllib.parse.urlparse(self.path).path
            if not path.startswith("/api/"):
                return self.send(404, {"error": "not found"})
            try:
                payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            except ValueError:
                return self.send(400, {"error": "bad json"})
            self.send(200, app.call(path[len("/api/"):], payload))

    return Handler


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--comfy", default="http://127.0.0.1:8188")
    p.add_argument("--output", default="/content/ComfyUI/output")
    p.add_argument("--loras", default="/content/ComfyUI/models/loras")
    p.add_argument("--dit", required=True)
    p.add_argument("--te", required=True)
    p.add_argument("--vae", required=True)
    p.add_argument("--cfg-text", type=float, default=3.0)
    args = p.parse_args()
    ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(App(args))).serve_forever()
