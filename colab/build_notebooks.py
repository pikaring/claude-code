"""colab/ 以下の2つのノートブックを生成する: python colab/build_notebooks.py"""
import json, os

def md(src):
    return {"cell_type": "markdown", "metadata": {}, "source": src}

def code(src, title=None):
    meta = {"cellView": "form"} if title else {}
    return {"cell_type": "code", "metadata": meta, "execution_count": None, "outputs": [], "source": src}

HERE = os.path.dirname(os.path.abspath(__file__))
APP_SRC = open(os.path.join(HERE, "mobile_app.py"), encoding="utf-8").read()
# ノートブックのセル5には mobile_app.py と同じ build_workflow を埋め込む
WORKFLOW_FN = APP_SRC.split("# --- workflow ---\n")[1].split("# --- end workflow ---")[0].strip("\n")
assert "'''" not in APP_SRC

cells = []

cells.append(md(
"""# Qwen-Image-2.1 on Colab (L4)

ComfyUI をバックグラウンドで動かし、**このノートブックのセルから**画像を生成します。

**使い方**：「ランタイム → ランタイムのタイプを変更」で **L4 GPU** を選び、上から順にセルを実行 → 「4. 画像を生成」のフォームを書き換えて何度でも実行。

| 部品 | ファイル | サイズ |
|---|---|---|
| DiT | `qwen_image_2.1-Q8_0.gguf`（pottokao/Qwen-Image-2.1-DiT-GGUF） | 7.7 GB |
| テキストエンコーダー | Heretic FP8（既定）または 公式 BF16 | 9.3 / 17.5 GB |
| VAE | `qwen_image_2.1_vae_bf16.safetensors`（Comfy-Org/Qwen-Image-2.1） | 0.7 GB |

> **注意**
> - Qwen-Image-2.1 本体（DiT / VAE）は **qwen-research ライセンス**です。個人の試用・研究向けで、商用や業務利用は条件を確認してください。
> - Heretic は拒否応答を除去した派生エンコーダーです。業務検証では「公式 BF16」を選んでください。
> - このノートブックは**セルの出力を保存しない設定**です（生成画像や表示はドライブ上の .ipynb に残りません）。生成画像は Google ドライブやフォトには**自動保存しません**。残したい画像だけ「5b」で端末にダウンロードしてください（ランタイムを削除すると VM 上の画像も消えます）。
"""))

cells.append(code(
"""#@title 1. GPU とメモリを確認
!nvidia-smi --query-gpu=name,memory.total --format=csv
import psutil
print(f"System RAM: {psutil.virtual_memory().total / 1e9:.1f} GB")
"""))

cells.append(code(
"""#@title 2. ComfyUI とカスタムノードをインストール（数分）
import os, subprocess

ROOT = "/content/ComfyUI"

def sh(cmd, cwd=ROOT):
    subprocess.run(cmd, shell=True, cwd=cwd, check=True)

os.makedirs(ROOT, exist_ok=True)
if not os.path.isdir(f"{ROOT}/.git"):
    # フォルダが先にできていても（モデルを先に落とした等）、その上に ComfyUI を展開する
    sh("git init -q && git remote add origin https://github.com/comfyanonymous/ComfyUI")
    sh("git fetch -q --depth 1 origin master && git checkout -q -f FETCH_HEAD")

for repo in ["city96/ComfyUI-GGUF", "pottokao-dotcom/ComfyUI-GGUF-Qwen3VL-TE"]:
    d = f"{ROOT}/custom_nodes/{repo.split('/')[1]}"
    if not os.path.isdir(f"{d}/.git"):
        sh(f"rm -rf {d} && git clone -q --depth 1 https://github.com/{repo} {d}")

sh("pip install -q -r requirements.txt -r custom_nodes/ComfyUI-GGUF/requirements.txt")
sh("pip install -q -U huggingface_hub hf_xet")
sh('git log -1 --format="ComfyUI commit: %h (%cd)"')
print("インストール完了")
""", title=True))

cells.append(code(
"""#@title 3. モデルをダウンロード（初回 5〜10 分）
TEXT_ENCODER = "Heretic FP8" #@param ["Heretic FP8", "公式 BF16"]

import os
from huggingface_hub import hf_hub_download

M = "/content/ComfyUI/models"
DIT = "qwen_image_2.1-Q8_0.gguf"
VAE = "qwen_image_2.1_vae_bf16.safetensors"

hf_hub_download("pottokao/Qwen-Image-2.1-DiT-GGUF", DIT, local_dir=f"{M}/diffusion_models")
hf_hub_download("Comfy-Org/Qwen-Image-2.1", f"vae/{VAE}", local_dir=M)

if TEXT_ENCODER == "Heretic FP8":
    TE = "qwen3vl_8b_fp8_heretic.safetensors"
    hf_hub_download("pottokao/Qwen-Image-2.1-Text-Encoder-Heretic-GGUF", TE, local_dir=f"{M}/text_encoders")
else:
    TE = "qwen3vl_8b_bf16.safetensors"
    hf_hub_download("Comfy-Org/Qwen-Image-2.1", f"text_encoders/{TE}", local_dir=M)

!ls -lh {M}/diffusion_models {M}/text_encoders {M}/vae | grep -v "put_"
""", title=True))

cells.append(code(
"""#@title 4. ComfyUI をバックグラウンドで起動
import subprocess, time, urllib.request

def comfy_ready():
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2)
        return True
    except Exception:
        return False

if not comfy_ready():
    log = open("/content/comfyui.log", "w")
    comfy = subprocess.Popen(
        ["python", "main.py", "--listen", "127.0.0.1", "--port", "8188"],
        cwd="/content/ComfyUI", stdout=log, stderr=subprocess.STDOUT)

for _ in range(120):
    if comfy_ready():
        print("ComfyUI 起動完了")
        break
    time.sleep(2)
else:
    print("起動に失敗しました。ログ ↓")
    print(open("/content/comfyui.log").read()[-3000:])
""", title=True))

cells.append(code(
"""#@title 5. 画像を生成（ここを書き換えて何度でも実行）
prompt = "A cozy Japanese city hall service counter at dusk, warm lighting, a wooden sign that says 市民課" #@param {type:"string"}
negative = "oversaturated, overexposed, gibberish text" #@param {type:"string"}
#@markdown 公式の推奨は約 400 万画素・40 ステップ（例 2048×2048、縦長 1792×2400）。人物は解像度を下げると崩れやすくなります
width = 2048 #@param {type:"slider", min:512, max:2752, step:32}
height = 2048 #@param {type:"slider", min:512, max:2752, step:32}
steps = 40 #@param {type:"integer"}
seed = -1 #@param {type:"integer"}
#@markdown **文字入りモード**：前半を cfg 1.0、`switch_step` 以降を `cfg_text` で描き直して文字をくっきりさせる
text_mode = False #@param {type:"boolean"}
switch_step = 24 #@param {type:"integer"}
cfg_text = 3.0 #@param {type:"number"}

import json, random, time, urllib.request, urllib.parse
from IPython.display import Image, display

""" + WORKFLOW_FN + """

API = "http://127.0.0.1:8188"

def api(path, data=None):
    req = urllib.request.Request(API + path, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req).read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()) from None

if seed < 0:
    seed = random.randint(0, 2**32 - 1)
wf = build_workflow(prompt, negative, width, height, steps, seed, text_mode, switch_step, cfg_text, DIT, TE, VAE)

t0 = time.time()
pid = api("/prompt", {"prompt": wf})["prompt_id"]
print(f"seed={seed}  生成中…（初回はモデル読み込みで時間がかかります）")
while True:
    h = api(f"/history/{pid}")
    if pid in h:
        break
    time.sleep(2)

status = h[pid]["status"]
if status.get("status_str") != "success":
    for kind, msg in status.get("messages", []):
        if kind == "execution_error":
            print(f"エラー（{msg['node_type']}）: {msg['exception_message']}")
    print("詳しくは最後のログ確認セルを実行してください")
else:
    print(f"完了 {time.time() - t0:.0f} 秒")
    for img in h[pid]["outputs"]["9"]["images"]:
        path = f"/content/ComfyUI/output/{img['subfolder']}/{img['filename']}"
        display(Image(filename=path, width=768))
        print("保存先: VM 内", path, "（ドライブ・フォトには保存していません）")
""", title=True))

cells.append(code(
"""#@title 5b.（任意）画像を端末にダウンロード
#@markdown 実行したときだけ、ブラウザのダウンロードとして端末に保存します（Google ドライブ・フォトは経由しません）。
target = "最新の1枚" #@param ["最新の1枚", "すべて（zip）"]

import glob, os, zipfile
from google.colab import files

imgs = sorted(glob.glob("/content/ComfyUI/output/qwen21_*.png"), key=os.path.getmtime)
if not imgs:
    print("まだ画像がありません")
elif target == "最新の1枚":
    files.download(imgs[-1])
else:
    zpath = "/content/qwen21_images.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        for f in imgs:
            z.write(f, os.path.basename(f))
    files.download(zpath)
""", title=True))

cells.append(md(
"""## （任意）ComfyUI の画面を開く

Colab 標準のポート転送で ComfyUI の画面を別ウィンドウに開きます。ngrok などの外部トンネルは使いません。
**無料枠では「Web UI 主体の操作」が禁止**されているため、有料ユニット（Google AI プラン特典など）がある場合だけ使ってください。
"""))

cells.append(code(
"""#@title 6.（任意）ComfyUI の画面を開く
from google.colab import output
output.serve_kernel_port_as_window(8188)
""", title=True))

cells.append(code(
"""#@title うまくいかないときのログ確認
!tail -n 60 /content/comfyui.log
""", title=True))

SETUP = cells[1:5]   # GPU 確認・インストール・ダウンロード・ComfyUI 起動
LOG = cells[-1]

mobile_cells = [md(
"""# Qwen-Image-2.1 スマホ版（L4）

**使い方**
1. 「ランタイム → ランタイムのタイプを変更」で **L4 GPU** を選ぶ（初回だけ）
2. 「ランタイム → **すべてのセルを実行**」
3. 最後のセルに出る画面でプロンプトを入れて「生成する」

初回は準備に 10〜15 分ほどかかります。使い終わったら「ランタイム → ランタイムを接続解除して削除」でユニットの消費を止めてください。

> **注意**
> - Qwen-Image-2.1 本体（DiT / VAE）は **qwen-research ライセンス**です。個人の試用・研究向けで、商用や業務利用は条件を確認してください。
> - Heretic は拒否応答を除去した派生エンコーダーです。業務検証ではセル3で「公式 BF16」を選んでください。
> - 生成画像は VM 内にだけ置き、Google ドライブやフォトには**自動保存しません**。残したい画像は画面の「ファイルに保存」から端末へ。セルの出力もノートブックに保存しない設定です。
> - 画面は Colab 標準のポート転送で開きます（ngrok などの外部トンネルは使いません）。**無料枠では Web UI 主体の操作が禁止**されているため、Colab Pro 相当の有料枠で使ってください。
""")] + SETUP + [code(
"""#@title 5. スマホ用の画面を開く
import subprocess, sys, time, urllib.request
from google.colab import output
from google.colab.output import eval_js

APP_SRC = r\'\'\'""" + APP_SRC + """\'\'\'

def app_ready():
    try:
        urllib.request.urlopen("http://127.0.0.1:8000/", timeout=2)
        return True
    except Exception:
        return False

if not app_ready():
    with open("/content/mobile_app.py", "w", encoding="utf-8") as f:
        f.write(APP_SRC)
    subprocess.Popen([sys.executable, "/content/mobile_app.py", "--dit", DIT, "--te", TE, "--vae", VAE],
                     stdout=open("/content/mobile_app.log", "w"), stderr=subprocess.STDOUT)
    for _ in range(30):
        if app_ready():
            break
        time.sleep(1)

if app_ready():
    print("別タブで開くとき（このランタイムの間だけ有効）:", eval_js("google.colab.kernel.proxyPort(8000)"))
    output.serve_kernel_port_as_iframe(8000, height=1100)
else:
    print("画面の起動に失敗しました")
    print(open("/content/mobile_app.log").read()[-2000:])
""", title=True), LOG]


def notebook(cells):
    return {
        "nbformat": 4, "nbformat_minor": 0,
        "metadata": {
            "colab": {"provenance": [], "gpuType": "L4", "machine_shape": "hm", "private_outputs": True},
            "kernelspec": {"name": "python3", "display_name": "Python 3"},
            "language_info": {"name": "python"},
            "accelerator": "GPU",
        },
        "cells": cells,
    }


if __name__ == "__main__":
    for name, c in [("qwen_image_21_colab_L4.ipynb", cells), ("qwen_image_21_mobile.ipynb", mobile_cells)]:
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
            json.dump(notebook(c), f, ensure_ascii=False, indent=1)
            f.write("\n")
