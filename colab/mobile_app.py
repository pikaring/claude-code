"""スマホ向けの Qwen-Image-2.1 生成画面。

Colab の VM 内で ComfyUI の API を叩く小さな Web サーバーです。
Colab 標準のポート転送（serve_kernel_port_as_iframe / proxyPort）で開きます。
画像は VM の ComfyUI/output にだけ置き、ドライブやフォトには保存しません。
"""
import argparse
import json
import os
import random
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# --- workflow ---
def build_workflow(prompt, negative, width, height, steps, seed, text_mode, switch_step, cfg_text, dit, te, vae, loras=()):
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
    def ksampler(add_noise, cfg, start, end, leftover, latent):
        return {"class_type": "KSamplerAdvanced", "inputs": {
            "model": ["10", 0], "add_noise": add_noise, "noise_seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": "euler", "scheduler": "simple",
            "positive": ["4", 0], "negative": ["4", 1], "latent_image": latent,
            "start_at_step": start, "end_at_step": end, "return_with_leftover_noise": leftover}}
    if text_mode:
        # 前半 cfg 1.0 で構図を決め、後半 cfg 3.0 ＋ネガティブで文字を描き直す
        wf["6"] = ksampler("enable", 1.0, 0, switch_step, "enable", ["5", 0])
        wf["7"] = ksampler("disable", cfg_text, switch_step, 10000, "disable", ["6", 0])
        last = "7"
    else:
        wf["6"] = ksampler("enable", 1.0, 0, 10000, "disable", ["5", 0])
        last = "6"
    wf["8"] = {"class_type": "VAEDecode", "inputs": {"samples": [last, 0], "vae": ["3", 0]}}
    wf["9"] = {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "qwen21"}}
    return wf
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
fetch("api/loras").then(r => r.json()).then(({loras}) => {
  for (const name of loras) loraEl.add(new Option(name.replace(/\.safetensors$/, ""), name));
  if (!loras.length) document.getElementById("lora_hint").textContent = "LoRA はまだありません（ノートブックのセル 3b で追加できます）";
}).catch(() => {});

const go = document.getElementById("go");
const statusEl = document.getElementById("status");
function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = isError ? "error" : "";
}

async function api(path, body) {
  const res = await fetch(path, body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

go.onclick = async () => {
  const prompt = document.getElementById("prompt").value.trim();
  if (!prompt) { setStatus("プロンプトを入力してください", true); return; }
  const seedText = document.getElementById("seed").value.trim();
  go.disabled = true;
  const t0 = Date.now();
  let timer;
  try {
    const job = await api("api/generate", {
      prompt, size: getSize(), quality: getQuality(),
      negative: document.getElementById("negative").value,
      text_mode: document.getElementById("text_mode").checked,
      seed: seedText === "" ? null : Number(seedText),
      lora: loraEl.value || null, lora_strength: Number(strengthEl.value),
    });
    let label = "送信しました";
    timer = setInterval(() => setStatus(`${label}… ${Math.round((Date.now() - t0) / 1000)} 秒`), 1000);
    for (;;) {
      await new Promise(r => setTimeout(r, 2000));
      const st = await api("api/status?id=" + encodeURIComponent(job.prompt_id));
      if (st.state === "queued") label = `順番待ち（${st.position} 番目）`;
      else if (st.state === "running") label = "生成中（初回はモデルの読み込みで数分、標準画質は 1 枚数分かかります）";
      else if (st.state === "error") throw new Error(st.error);
      else if (st.state === "done") { showResult(st.image, job.seed, job.lora, prompt, (Date.now() - t0) / 1000); break; }
    }
    setStatus(`完了（${Math.round((Date.now() - t0) / 1000)} 秒）`);
  } catch (e) {
    setStatus("エラー：" + e.message, true);
  } finally {
    clearInterval(timer);
    go.disabled = false;
  }
};

function showResult(name, seed, lora, prompt, secs) {
  const url = "api/image?name=" + encodeURIComponent(name);
  const card = document.createElement("div");
  card.className = "card result";
  const img = document.createElement("img");
  img.src = url; img.alt = prompt;
  const meta = document.createElement("div");
  meta.className = "meta";
  const info = document.createElement("span");
  info.textContent = `seed ${seed}${lora ? " ・ LoRA " + lora : ""} ・ ${Math.round(secs)} 秒`;
  const dl = document.createElement("a");
  dl.href = url + "&download=1"; dl.textContent = "ファイルに保存";
  dl.setAttribute("download", name);
  meta.append(info, dl);
  card.append(img, meta);
  document.getElementById("results").prepend(card);
}
</script>
</body>
</html>
"""


def make_handler(args):
    def comfy(path, data=None):
        req = urllib.request.Request(
            args.comfy + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json"})
        try:
            return json.loads(urllib.request.urlopen(req, timeout=30).read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(e.read().decode()[:500]) from None

    def list_loras():
        if not os.path.isdir(args.loras):
            return []
        return sorted(f for f in os.listdir(args.loras) if f.endswith(".safetensors"))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json", extra=None):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(url.query)
            try:
                if url.path == "/":
                    self.send(200, PAGE.encode(), "text/html; charset=utf-8")
                elif url.path == "/api/loras":
                    self.send(200, {"loras": list_loras()})
                elif url.path == "/api/status":
                    self.send(200, self.status(q.get("id", [""])[0]))
                elif url.path == "/api/image":
                    name = q.get("name", [""])[0]
                    if not IMAGE_NAME.match(name):
                        return self.send(400, {"error": "bad name"})
                    with open(os.path.join(args.output, name), "rb") as f:
                        extra = {"Content-Disposition": f'attachment; filename="{name}"'} if "download" in q else None
                        self.send(200, f.read(), "image/png", extra)
                else:
                    self.send(404, {"error": "not found"})
            except Exception as e:
                self.send(500, {"error": str(e)})

        def do_POST(self):
            if urllib.parse.urlparse(self.path).path != "/api/generate":
                return self.send(404, {"error": "not found"})
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                prompt = str(body.get("prompt", "")).strip()
                if not prompt:
                    return self.send(400, {"error": "プロンプトが空です"})
                width, height = SIZES.get(body.get("size"), SIZES["1:1"])
                scale, steps = QUALITY.get(body.get("quality"), QUALITY["high"])
                width, height = int(width * scale), int(height * scale)
                seed = body.get("seed")
                seed = random.randint(0, 2**32 - 1) if seed is None else int(seed)
                lora = body.get("lora")
                if lora and lora not in list_loras():
                    return self.send(400, {"error": f"LoRA が見つかりません: {lora}"})
                strength = min(max(float(body.get("lora_strength", 0.8)), 0.0), 2.0)
                wf = build_workflow(prompt, str(body.get("negative", "")), width, height, steps, seed,
                                    # 文字入りモードは前半 6 割を cfg 1.0、残りを cfg_text で
                                    bool(body.get("text_mode")), round(steps * 0.6), args.cfg_text,
                                    args.dit, args.te, args.vae, [(lora, strength)] if lora else [])
                pid = comfy("/prompt", {"prompt": wf})["prompt_id"]
                self.send(200, {"prompt_id": pid, "seed": seed,
                                "lora": f"{lora.removesuffix('.safetensors')} ×{strength:g}" if lora else None})
            except Exception as e:
                self.send(500, {"error": str(e)})

        def status(self, pid):
            h = comfy(f"/history/{urllib.parse.quote(pid)}")
            if pid not in h:
                q = comfy("/queue")
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
    ThreadingHTTPServer(("0.0.0.0", args.port), make_handler(args)).serve_forever()
