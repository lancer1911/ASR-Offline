"""
Build Lancer1911 ASR Offline as a lightweight macOS .app using py2app.

Recommended build steps:
  python3 -m venv ~/asr-offline-build-env
  source ~/asr-offline-build-env/bin/activate
  pip install --upgrade pip setuptools wheel py2app
  cd /path/to/asr_offline
  python build_mac.py py2app

Output:
  ~/Playground/asr_offline/dist/Lancer1911 ASR Offline.app

Runtime note:
  The generated .app is intentionally lightweight. It launches main.py with an
  external Python environment, preferably ~/asr-offline-env, so MLX / Whisper /
  LLM dependencies do not need to be bundled into the app.
"""
import sys
from pathlib import Path
from setuptools import setup

APP_NAME = "Lancer1911 ASR Offline"
VERSION = "0.7b"
BUNDLE_ID = "com.lancer1911.asroffline"

ROOT = Path(__file__).resolve().parent
OUT = Path.home() / "Playground" / "asr_offline"
OUT.mkdir(parents=True, exist_ok=True)

# py2app does not accept build_base the same way as normal setuptools builds;
# inject --dist-dir so outputs are separated from the source folder.
dist_dir = str(OUT / "dist")
if "py2app" in sys.argv and "--dist-dir" not in sys.argv:
    sys.argv += ["--dist-dir", dist_dir]

static_files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "static").glob("*"))
root_files = [
    "main.py",
    "server.py",
    "model_worker.py",
    "requirements.txt",
]
for optional in ["README.md", "README-ZH.md", "安装与使用说明.md", "打包说明.md"]:
    if (ROOT / optional).exists():
        root_files.append(optional)

py2app_options = {
    "argv_emulation": False,
    "plist": {
        "CFBundleName": APP_NAME,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleVersion": VERSION,
        "CFBundleShortVersionString": VERSION,
        "LSMinimumSystemVersion": "13.0",
        "NSLocalNetworkUsageDescription": "The app runs a local server for communication between the desktop window and the local ASR backend.",
        "NSDocumentsFolderUsageDescription": "The app lets you open audio/session files and save subtitle/session files selected by you.",
        "NSDownloadsFolderUsageDescription": "The app may save exported subtitles, ASO sessions, or debug files to Downloads when requested.",
    },
    "packages": ["encodings"],
    "includes": [
        "encodings", "encodings.utf_8", "encodings.ascii", "encodings.latin_1",
        "os", "sys", "subprocess", "pathlib", "json", "time",
    ],
    # The real ASR runtime is loaded by the external Python environment via
    # launcher.py. Excluding heavy packages keeps the .app small and avoids
    # py2app dependency-resolution problems with MLX/Torch/scipy stacks.
    "excludes": [
        "tkinter", "matplotlib", "test", "unittest",
        "PyQt5", "PyQt6", "wx", "PIL",
        "mlx", "mlx_lm", "mlx_whisper", "torch", "torchaudio",
        "numpy", "scipy", "onnxruntime", "sounddevice",
        "fastapi", "uvicorn", "starlette", "webview", "pywebview",
    ],
    "semi_standalone": False,
    "strip": True,
}

icon_path = ROOT / "icon.icns"
if icon_path.exists():
    py2app_options["iconfile"] = str(icon_path)

setup(
    app=["launcher.py"],
    name=APP_NAME,
    data_files=[
        ("static", static_files),
        ("", root_files),
    ],
    options={"py2app": py2app_options},
    setup_requires=["py2app"],
)
