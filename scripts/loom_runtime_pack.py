#!/usr/bin/env python3
"""把织布机运行时打成一个可分发包（β1 可选组件）。

产物（`--out` 目录下）：
  - `loom-runtime-<version>.tar.bz2`：运行时本体（CPython + 织布机源码 + 启动 shim）
  - `loom-runtime.json`：清单（schemaVersion:1 / version / url / sha256 / bytes / note）

设计要点（与 β 决策稿一致）：
- **不进安装包**：这是「可选组件」的分发件，只有用户点了安装才下载。
- **最小集**：CPython 嵌入式发行版 + PyYAML（织布机唯一的硬依赖）。其余依赖缺了织布机会
  「如实回报跳过原因」，这是它自己的设计，不是缺陷。
- **绝不带 `.env`**：织布机仓根那个文件里有真实 key，任何情况下都不进包。
- 版本目录名守卫、sha256 清单单一出处（`loom-runtime.json`），由前端与 Rust 各自校验。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

EMBED_URL = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
GET_PIP_URL = "https://bootstrap.pypa.io/get-pip.py"

# 复制进包里的源码子集：不含测试、.git、.env、benchmark、.venv 等
SOURCE_DIRS = ["loom_core", "agents", "packs", "artesian", "loom_doc", "docpipeline", "pipeline_core", "pipelines", "scripts"]
SOURCE_FILES = ["run.py"]
EXCLUDE_NAMES = {".env", "__pycache__", ".git", ".venv", "benchmark.py", "tests"}

LAUNCHER = '''import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "loom")
os.chdir(ROOT)
sys.path.insert(0, ROOT)
os.environ.setdefault("LOOM_ROOT", ROOT)
os.environ.setdefault("LOOM_STATE_DIR", os.path.join(HERE, ".state"))
os.environ.setdefault("LOOM_VERSIONS_DIR", os.path.join(HERE, ".versions"))

from loom_core.mcp_server import run_mcp_server

run_mcp_server()
'''


def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as r, dest.open("wb") as f:
        shutil.copyfileobj(r, f)


def copy_tree(src: Path, dst: Path) -> None:
    def ignore(_dir: str, names: list[str]) -> set[str]:
        return {n for n in names if n in EXCLUDE_NAMES or n.endswith(".pyc")}

    shutil.copytree(src, dst, ignore=ignore)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="产物输出目录（空目录或不存在皆可）")
    ap.add_argument("--version", default="v0.1.0")
    ap.add_argument("--nexusloom", required=True, help="织布机仓根（只读复制，不会动它）")
    ap.add_argument("--embed-url", default=EMBED_URL)
    ap.add_argument("--asset-url", default="", help="清单里写的下载地址（默认同仓 Release）")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    stage = out / "stage"
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    tree = stage / "tree"
    tree.mkdir()

    py_zip = stage / "embed.zip"
    print(f"[1/6] 下载嵌入式 CPython：{args.embed_url}")
    fetch(args.embed_url, py_zip)
    with zipfile.ZipFile(py_zip) as z:
        z.extractall(tree / "python")

    print("[2/6] 装 pip 与 PyYAML（织布机唯一的硬依赖）")
    # 嵌入式发行版的 `._pth` 默认把 `import site` 注释掉 ⇒ pip 起不来；先放开它。
    for pth in (tree / "python").glob("python*._pth"):
        text = pth.read_text(encoding="utf-8")
        pth.write_text(text.replace("#import site", "import site"), encoding="utf-8")
    get_pip = stage / "get-pip.py"
    fetch(GET_PIP_URL, get_pip)
    python = tree / "python" / "python.exe"
    subprocess.run([str(python), str(get_pip), "--no-warn-script-location"], check=True)
    subprocess.run(
        [str(python), "-m", "pip", "install", "--no-warn-script-location", "--target", str(tree / "python" / "Lib" / "site-packages"), "pyyaml"],
        check=True,
    )

    src = Path(args.nexusloom).resolve()
    dst = tree / "loom"
    dst.mkdir()
    print(f"[3/6] 复制织布机源码子集：{src}")
    for d in SOURCE_DIRS:
        p = src / d
        if p.is_dir():
            copy_tree(p, dst / d)
    for f in SOURCE_FILES:
        if (src / f).is_file():
            shutil.copy2(src / f, dst / f)
    # 显式排雷：`.env` 一律不进包（即使复制时漏了排除规则也兜住）
    for bad in tree.rglob(".env"):
        bad.unlink()

    (tree / "run-mcp.py").write_text(LAUNCHER, encoding="utf-8")

    version = args.version
    bundle = out / f"loom-runtime-{version}.tar.bz2"
    print(f"[4/6] 打包：{bundle.name}")
    with tarfile.open(bundle, "w:bz2") as tf:
        for item in sorted(tree.iterdir()):
            tf.add(item, arcname=item.name)

    digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
    size = bundle.stat().st_size
    url = args.asset_url or f"https://github.com/Levango7/Modulo/releases/download/loom-runtime-{version}/{bundle.name}"
    manifest = {
        "schemaVersion": 1,
        "version": version,
        "url": url,
        "sha256": digest,
        "bytes": size,
        "note": "核心集（CPython 嵌入式 + PyYAML + 织布机源码；不含 .env / 测试 / ocr / embed）",
    }
    (out / "loom-runtime.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[5/6] sha256={digest} bytes={size}")
    print(f"[6/6] 清单：{out / 'loom-runtime.json'}")
    print("上传示例：gh release create loom-runtime-" + version + " --title 织布机运行时 " + version + " " + str(bundle) + " " + str(out / "loom-runtime.json"))


if __name__ == "__main__":
    main()
