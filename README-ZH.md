🌐 [English](README.md)

# Lancer1911 ASR Offline

> 完全离线的音频 / 视频转录、LLM 语义校对、多语言翻译与说话人识别工具  
> 专为 Apple Silicon 设计 — 适合会议录音、访谈、听证、课程、视频文件和长音频的本地批处理

![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20only-black?logo=apple)
![RAM](https://img.shields.io/badge/RAM-24%20GB%20minimum-red)
![Python](https://img.shields.io/badge/python-3.11%2B-blue?logo=python)
![MLX](https://img.shields.io/badge/MLX-local%20inference-orange)
![Version](https://img.shields.io/badge/version-0.6i-informational)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ⚠️ 硬件要求

Lancer1911 ASR Offline 会在本机运行 Whisper ASR、Qwen3 LLM，以及可选的说话人声纹模型。音频和文字数据不上传到云端，但这也意味着所有模型和处理中间数据都需要放入本机统一内存。

|  | 最低配置 | 推荐配置 |
|---|---|---|
| **芯片** | Apple M1 | M2 Pro / M3 / M4 或更新 |
| **统一内存** | **24 GB** | **48 GB** |
| **存储空间** | 15 GB 可用 | 30 GB 可用，长音频建议更多 |
| **macOS 版本** | 13 Ventura | 14 Sonoma 或更新 |

> **为什么建议 24 GB 以上？** 默认模型组合通常包括 `whisper-large-v3-turbo` 与 `Qwen3-14B-4bit`。ASR、LLM、pywebview、FastAPI、音频缓冲、字幕数据和导出数据会同时占用内存。16 GB 设备可能可以运行较短任务，但长音频、多语种翻译或较大 LLM 容易触发内存交换、明显变慢，甚至崩溃。若只有 16 GB，建议使用更小的 LLM，并关闭说话人识别和多语种翻译。

---

## 截图

<p align="center">
  <img src="images/screenshot_main.png" alt="主界面 — 文件上传、处理流程与字幕校对" width="800">
  <br><em>主界面 — 拖放文件、查看处理阶段、校对字幕与翻译</em>
</p>

<p align="center">
  <img src="images/screenshot_advanced.png" alt="高级 ASR / LLM 参数" width="640">
  <br><em>高级设置 — ASR / LLM 参数、内置 presets 和自定义 presets</em>
</p>

<p align="center">
  <img src="images/screenshot_review.png" alt="字幕校对与播放同步" width="800">
  <br><em>校对界面 — 字幕卡片、原始 ASR、单句翻译、播放跟随与导出</em>
</p>

---

## 功能特性

- **完全离线** — 音频转录、LLM 校对、翻译和说话人识别均在本机运行；文件内容不会离开你的 Mac。
- **面向文件的离线流程** — 支持拖放音频或视频文件，先进行文件检查与音频转换，再执行 ASR、LLM 校对、可选翻译与说话人识别。
- **支持常见音视频格式** — 支持 MP3、MP4、M4A、WAV、FLAC、AAC、OGG 等由 ffmpeg 可解码的格式。
- **Whisper ASR** — 默认使用 `mlx-community/whisper-large-v3-turbo`，可锁定中文、英文、日文、韩文、粤语，或使用自动检测。
- **LLM 两阶段校对** — 使用 Qwen3 等 MLX LLM 对 ASR 文本进行语义修正、标点整理、切句与术语修复。
- **多语言翻译** — 可选择中文、英文、日文、韩文、法文、德文、西班牙文作为翻译目标；支持处理完成后自动补翻译，也支持后续“重新全文翻译”。
- **字幕卡片校对** — 每条字幕可手工编辑、保存、保存并翻译；可显示原始 ASR 文本，便于核对模型改动。
- **ASO 会话文件** — 可保存完整会话为 `.aso`，包含字幕、翻译、说话人标签、设置、调试信息和原始音频元信息；下次加载时可自动或手动配对原始音频。
- **播放与跟随** — 后端使用与 ASR 相同的 16 kHz 音频生成 WAV 供前端播放；支持播放 / 暂停、进度拖动、音量调节、点击字幕跳转和跟随播放高亮。
- **说话人识别** — 可选启用声纹聚类；支持 LLM 完成后自动运行、手动重新识别、仅重新聚类、说话人重命名与字幕卡片手动修正。
- **高级 ASR / LLM 参数** — 顶栏齿轮按钮打开高级设置，可调 ASR 阈值、LLM token 预算、分块大小、随机性等参数。
- **参数 presets** — 内置“默认 / 平衡”“远距离 / 声音闷”“噪声多 / 抑制幻觉”“长句 / 多语种翻译”“速度优先”“质量优先”；也可保存、覆盖和删除自定义 preset。
- **科幻展示层** — 处理期间显示 ASR / LLM 中间过程，可在“流光溢彩”和“黑客帝国”两种文字前景发光效果之间切换。
- **调试输出** — 可将 ASR、LLM、说话人识别等阶段中间结果输出到 `~/Downloads`，便于定位长音频截断、JSON 解析、翻译缺失等问题。
- **多格式导出** — 支持 SRT、TXT、Markdown、JSON；可导出混合语言，也可选择单一语言。
- **双语界面** — 顶栏 EN / 中文按钮可在中文和英文 UI 之间切换。
- **深色 / 浅色主题** — 顶栏主题按钮可切换外观。

---

## 快速开始

### 1. 克隆或解压项目

```bash
git clone https://github.com/lancer1911/ASR-Offline.git
cd ASR-Offline
```

如果你使用的是压缩包版本，直接解压后进入项目目录即可。

### 2. 安装系统依赖

```bash
brew install ffmpeg
```

`ffmpeg` 和 `ffprobe` 用于检查音视频文件、抽取音频并转换为 ASR 使用的 16 kHz mono f32 PCM。

### 3. 创建运行环境

建议使用独立环境：

```bash
python3 -m venv ~/asr-offline-env
source ~/asr-offline-env/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

如果你已经为 ASR 项目创建过 `~/asr-env`，打包版启动器也会尝试自动寻找该环境。

### 4. 下载 ASR 模型

```bash
# 默认推荐模型，速度和质量较均衡
hf download mlx-community/whisper-large-v3-turbo

# 可选：更高精度但更慢
# hf download mlx-community/whisper-large-v3-mlx
```

### 5. 下载 LLM 模型

```bash
# 默认推荐，适合 24 GB 以上统一内存
hf download mlx-community/Qwen3-14B-4bit

# 可选：质量更高，但建议 48 GB 以上统一内存
# hf download mlx-community/Qwen3-30B-A3B-Instruct-2507-4bit
```

模型下载后会保存在 `~/.cache/huggingface/hub/`，离线状态下也可继续使用。

### 6. 说话人识别依赖（可选）

当前版本使用本地声纹 embedding / 聚类方式进行说话人识别，需要额外依赖：

```bash
source ~/asr-offline-env/bin/activate
pip install resemblyzer scipy
```

如果你的环境已通过 `requirements.txt` 安装，通常无需单独执行。说话人识别会增加处理时间；长音频或内存紧张时可关闭。

### 7. 启动

```bash
source ~/asr-offline-env/bin/activate
python main.py
```

应用会启动本地 FastAPI 服务，并通过 pywebview 打开桌面窗口。默认服务端口为：

```text
http://127.0.0.1:17434
```

首次启动需要加载 ASR 和 LLM 模型，可能等待 30–60 秒。状态栏显示就绪后即可拖放文件。

---

## 基本使用流程

### 1. 上传文件

将音频或视频文件拖放到主界面的上传框，或点击选择文件。应用会先调用 `ffprobe` 检查时长、格式、采样率、声道和码率，再通过 `ffmpeg` 转换为 16 kHz mono f32 临时音频。

### 2. 开始转录

文件检查通过后，点击**开始转录**。处理流程通常包括：

```text
① 上传 → ② ASR → ③ LLM 纠错 → ④ 说话人识别（可选） → ⑤ 校对
```

ASR 阶段输出原始转录和时间戳；LLM 阶段进行语义校正、切句和翻译字段生成；说话人识别阶段根据音频和字幕时间段进行声纹聚类。

### 3. 校对字幕

进入校对界面后，每条字幕卡片可进行：

- 查看校正文本；
- 展开原始 ASR 文本；
- 单句翻译；
- 编辑并保存；
- 保存并重新翻译；
- 修改说话人标签；
- 点击字幕跳转到对应音频位置。

### 4. 重新全文翻译

在右侧设置区选择目标语言后，可点击**重新全文翻译**。应用会清空旧译文并按当前目标语言重新生成翻译。该功能适合加载旧 ASO 文件后补充缺失语言，或临时增加新的目标语言。

### 5. 保存会话

点击顶栏**保存**可保存 `.aso` 会话文件。建议将 `.aso` 与原始音频放在同一目录；下次加载 `.aso` 时，应用会尝试根据保存的音频文件名自动配对原始音频。如果未能自动找到，会提示手动选择音频。

---

## 设置说明

### Whisper ASR 模型

下拉框会列出本地可用的 Whisper / MLX ASR 模型。默认推荐：

```text
mlx-community/whisper-large-v3-turbo
```

### LLM 模型

下拉框会列出本地可用的 MLX LLM 模型。默认推荐：

```text
mlx-community/Qwen3-14B-4bit
```

更大的模型通常可以提升校对和翻译质量，但会显著增加内存占用和处理时间。

### 识别语言

可选：

| 选项 | 用途 |
|---|---|
| 自动检测 | 多语种材料或不确定语言时使用 |
| 中文 | 中文会议、中文讲座、中文访谈 |
| 英文 | 英文会议、英文视频 |
| 日文 | 日文音频 |
| 韩文 | 韩文音频 |
| 粤语 | 粤语音频 |

单一语言材料建议锁定语言，可减少误检测。

### 翻译目标

可勾选多个目标语言。目标语言越多，LLM 输出字段越多，处理时间越长，也更容易触发 token 上限。若出现翻译截断，可在高级设置中提高翻译 token 预算。

### 场景提示词

用于向 ASR 和 LLM 提供领域背景、专有名词和术语列表。建议直接列出关键术语，而不是写很长的背景描述。

```text
专利听证。术语：权利要求、说明书、创造性、现有技术、等同原则、禁止反悔、无效宣告。
```

```text
医学访谈。术语：心房颤动、冠状动脉、射血分数、糖化血红蛋白、肾小球滤过率。
```

### 说话人识别

| 参数 | 默认值 | 说明 |
|---|---|---|
| 启用说话人识别 | 关闭 | 开启后会在 LLM 完成后进行声纹聚类 |
| LLM 完成后自动运行 | 开启 | 关闭后可手动点击重新识别 |
| 聚类阈值 | 0.05 | 越小越严格，可能分出更多人；越大越宽松，可能把不同人合并 |

若识别出的人数过多，可调大阈值并点击**仅重新聚类**；若不同说话人被合并，可调小阈值并重新聚类或重新识别。

---

## 高级 ASR / LLM 参数

点击顶栏齿轮按钮进入高级设置。除非遇到明显问题，建议保持默认值或使用内置 preset。

### ASR 参数

| 参数 | 默认值 | 简要说明 |
|---|---:|---|
| `asr_temperature` | `0.0` | ASR 采样随机性。通常保持 0，避免不稳定输出。 |
| `asr_condition_on_previous_text` | `false` | 是否参考前文。关闭可减少前文污染、重复和幻觉；长上下文连续性不足时可尝试开启。 |
| `asr_no_speech_threshold` | `0.45` | 无语音判断阈值。远距离、声音闷、音量低时可降低到 0.35 左右；噪声多时可提高。 |
| `asr_compression_ratio_threshold` | `1.8` | 重复 / 异常输出过滤阈值。重复幻觉多时降低；真实语音被误过滤时略微提高。 |
| `asr_logprob_threshold` | `-1.0` | 置信度阈值。弱音频可降低到 -1.2；幻觉多时提高到 -0.8 左右。 |
| `asr_fp16` | `true` | 使用半精度推理。Apple Silicon 上通常保持开启。 |

### LLM 参数

| 参数 | 默认值 | 简要说明 |
|---|---:|---|
| `llm_temperature` | `0.0` | LLM 随机性。纠错和翻译建议保持 0。 |
| `llm_context_prompt_max_chars` | `300` | 场景提示词最大注入长度。术语很多时可增加。 |
| `llm_phase1_chunk_max_chars` | `350` | Phase 1 分块大小。过小会增加调用次数；过大可能影响稳定性。 |
| `llm_phase1_max_tokens` | `1200` | Phase 1 输出 token 预算。长句被截断时可增加。 |
| `llm_phase1_min_length_ratio` | `0.5` | Phase 1 输出过短时的容错比例。 |
| `llm_phase2_base_max_tokens` | `1200` | Phase 2 基础输出预算。 |
| `llm_phase2_tokens_per_target_lang` | `600` | Phase 2 每个翻译目标语言增加的 token 预算。 |
| `llm_translate_base_tokens` | `800` | 单句 / 批量翻译基础 token 预算。 |
| `llm_translate_tokens_per_target_lang` | `350` | 单句翻译每个目标语言增加的 token 预算。 |
| `llm_translate_max_tokens_cap` | `2400` | 单句翻译 token 上限。 |

### 内置 presets

| Preset | 适用场景 |
|---|---|
| 默认 / 平衡 | 一般录音，优先稳定性 |
| 远距离 / 声音闷 | 声音小、距离远、辅音不清楚，减少漏识别 |
| 噪声多 / 抑制幻觉 | 背景噪声强、重复输出多、幻觉多 |
| 长句 / 多语种翻译 | 句子长、翻译目标语言多、容易截断 |
| 速度优先 | 减少 token 预算，提高速度 |
| 质量优先 | 增加 token 预算，牺牲速度换取更完整输出 |

可将当前参数保存为自定义 preset。自定义 preset 保存在本机设置文件中：

```text
~/.asroffline_settings.json
```

---

## ASO 会话文件

`.aso` 是 Lancer1911 ASR Offline 的完整会话格式，通常包含：

- 字幕 entries；
- 原始 ASR 文本和时间戳；
- LLM 校对文本；
- 翻译结果；
- 说话人标签和自定义名称；
- 当前设置；
- 原始音频文件名、时长、格式等元信息；
- 调试面板数据。

建议保存结构：

```text
ProjectFolder/
├── interview_2026-05-07.mp3
└── interview_2026-05-07.aso
```

加载 `.aso` 时，如果同目录存在同名或匹配的原始音频，应用会自动转换并恢复 playback；否则会提示选择音频文件进行配对。

---

## 导出

点击底部或顶栏导出菜单，可选择混合语言或单语导出。

| 格式 | 说明 |
|---|---|
| SRT | 标准字幕格式，适合视频剪辑软件 |
| TXT | 带时间戳的纯文本 |
| Markdown | 适合 Obsidian、Notion、报告整理 |
| JSON | 完整结构化数据，适合后续程序处理 |

混合语言导出会包含原文、译文、说话人和时间戳。单语导出会从已存在的原文 / 译文语言中选择一种语言输出。

---

## 打包为 macOS .app

本项目采用轻量壳程序方式打包：`.app` 内包含项目代码和静态资源，但不内嵌 MLX、模型和大型依赖；启动后会寻找外部 Python 环境运行真正的后端。

### 1. 准备运行环境

```bash
python3 -m venv ~/asr-offline-env
source ~/asr-offline-env/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
```

### 2. 准备打包环境

```bash
python3 -m venv ~/asr-offline-build-env
source ~/asr-offline-build-env/bin/activate
pip install --upgrade pip setuptools wheel py2app
```

### 3. 构建

```bash
rm -rf build dist
python build_mac.py py2app
```

输出应用：

```text
dist/Lancer1911 ASR Offline.app
```

### 4. 首次启动 Gatekeeper 提示

如 macOS 阻止打开，可执行：

```bash
xattr -cr "/Applications/ASR Offline.app"
```

也可右键应用 → 打开 → 在弹窗中再次点击“打开”。

应用日志位置：

```text
~/Library/Logs/ASROffline.log
```

---

## 常见问题

**启动后长时间显示连接中。**  
首次加载 ASR 和 LLM 模型需要时间。请等待状态栏显示模型就绪。如果超过数分钟，查看 `~/Library/Logs/ASROffline.log`。

**提示端口被占用。**  
默认端口为 17434，可用以下命令检查：

```bash
lsof -i :17434
```

必要时终止占用进程：

```bash
lsof -ti :17434 | xargs kill -9
```

**上传文件失败或显示解码失败。**  
确认已安装 ffmpeg：

```bash
ffmpeg -version
ffprobe -version
```

若视频文件没有音轨，也会检查失败。

**翻译没有出现。**  
先确认右侧已选择翻译目标语言并保存设置。若加载旧 ASO 文件，可点击**重新全文翻译**补齐。若仍失败，开启调试输出并检查 `~/Downloads` 中的 LLM JSON。

**远距离录音、声音闷、漏识别。**  
可在高级设置中选择“远距离 / 声音闷” preset，或手动尝试：`no_speech_threshold = 0.35`，`logprob_threshold = -1.2`，`compression_ratio_threshold = 2.0`。若出现幻觉，再逐步收紧。

**噪声多、出现不存在的话或重复句子。**  
可选择“噪声多 / 抑制幻觉” preset，或提高 `no_speech_threshold`、提高 `logprob_threshold`、降低 `compression_ratio_threshold`。

**说话人数量不对。**  
如果同一个人被分成多人，调大聚类阈值后点击**仅重新聚类**；如果不同人被合并，调小阈值或重新识别。

**ASO 加载后不能播放。**  
将 `.aso` 与原始音频放在同一目录并保持原文件名，或在提示时手动选择音频文件配对。

**处理长音频很慢。**  
减少翻译目标语言，关闭说话人识别，使用较小 LLM，或选择“速度优先” preset。

---

## 依赖项

| 项目 | 用途 |
|---|---|
| [mlx-whisper](https://github.com/ml-explore/mlx-examples) | 在 Apple Silicon 上运行 Whisper ASR |
| [mlx-lm](https://github.com/ml-explore/mlx-examples) | 在 Apple Silicon 上运行 LLM |
| [FastAPI](https://fastapi.tiangolo.com) | 本地后端 API 与 WebSocket 服务 |
| [uvicorn](https://www.uvicorn.org) | ASGI 服务运行器 |
| [pywebview](https://pywebview.flowrl.com) | macOS 桌面窗口 |
| [ffmpeg](https://ffmpeg.org) | 音视频检查、解码和格式转换 |
| [Qwen3](https://huggingface.co/Qwen) | LLM 校对和翻译 |
| [Whisper large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) | 默认 ASR 模型 |
| [resemblyzer](https://github.com/resemble-ai/Resemblyzer) | 说话人声纹 embedding |
| [scipy](https://scipy.org) | 声纹聚类和科学计算 |
| [numpy](https://numpy.org) | 音频数组处理 |

---

## 许可证

MIT
