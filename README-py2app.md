# Lancer1911 ASR Offline — py2app 打包说明

本版本增加了 `launcher.py` 和 `build_mac.py`，可以用 `py2app` 生成 macOS `.app`。

## 设计方式

生成的 `.app` 是轻量壳程序：

1. `.app` 内包含 `main.py`、`server.py`、`model_worker.py`、`static/` 等项目文件；
2. `.app` 启动后，`launcher.py` 会寻找外部 Python 环境；
3. 优先使用 `~/asr-offline-env/bin/python3`，其次尝试 `~/asr-env/bin/python3`、pyenv、Homebrew Python；
4. 真正的 FastAPI / pywebview / MLX / Whisper / LLM 运行在该外部环境中。

这样做的原因是 MLX、Whisper、LLM、onnxruntime、scipy 等依赖较重，直接塞进 py2app 容易失败或生成非常大的 `.app`。

## 一、准备运行环境

建议单独创建运行环境：

```bash
python3 -m venv ~/asr-offline-env
source ~/asr-offline-env/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

如果你已经使用 `~/asr-env` 作为 ASR 环境，也可以继续使用，`launcher.py` 会自动查找。

## 二、准备打包环境

可以使用同一个环境，也可以单独创建：

```bash
python3 -m venv ~/asr-offline-build-env
source ~/asr-offline-build-env/bin/activate
pip install --upgrade pip setuptools wheel py2app
```

## 三、生成 .app

进入项目目录后执行：

```bash
python build_mac.py py2app
```

默认输出位置：

```text
~/Playground/asr_offline/dist/Lancer1911 ASR Offline.app
```

## 四、运行和日志

双击 `.app` 即可启动。日志写入：

```text
~/Library/Logs/ASROffline.log
```

如果双击后没有反应，优先查看该日志。

## 五、图标

如果项目根目录存在 `icon.icns`，`build_mac.py` 会自动使用它作为 App 图标。没有该文件时也可以正常打包，只是使用默认图标。
