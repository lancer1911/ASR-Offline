"""
Lancer1911 ASR Offline v0.7a — FastAPI 后端
四阶段流水线：文件检查 → Whisper ASR → LLM纠错 → 说话人识别 → 手工校对/翻译
"""
import asyncio, json, os, re, time, hashlib, threading, tempfile, queue as _queue
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

try:
    import multipart  # noqa
except ImportError:
    import sys, subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                           "python-multipart", "-q"])

# 文件保存对话框队列（由 main.py 注入；纯浏览器模式下为 None）
_DIALOG_Q: Optional[_queue.Queue] = None

# ── 全局状态 ─────────────────────────────────────────────────
class State:
    def __init__(self):
        self.worker         = None
        self.worker_ready   = False
        self._worker_lock   = threading.Lock()
        self.ws_clients: list = []
        self.settings: dict = {}
        # 当前 job
        self.job_status: str    = "idle"   # idle|checking|ready|asr|llm|diarize|review|error
        self.job_entries: list  = []
        self.job_file_info: dict = {}
        self.job_audio_path: str = ""      # 临时 16kHz mono f32 音频文件路径
        self.job_raw_text: str  = ""
        self.job_segments: list = []
        self.job_gaps: list     = []
        self.job_duration: float = 0.0
        self.job_diarize_cache_key: str = ""   # 用于声纹嵌入复用
        self.pending_translate: bool = False   # ASO 加载后等 worker 就绪再补翻译

G   = State()
_main_loop: Optional[asyncio.AbstractEventLoop] = None

# ── 默认设置 ─────────────────────────────────────────────────
DEFAULT_SETTINGS = {
    "whisper_repo":     "mlx-community/whisper-large-v3-turbo",
    "llm_repo":         "mlx-community/Qwen3-14B-4bit",
    "asr_language":     None,
    "translate_to":     [],
    "translate_map": {
        "中文":"Chinese","英文":"English","日文":"Japanese",
        "韩文":"Korean","法文":"French","德文":"German","西班牙文":"Spanish",
    },
    "context_prompt":   "",
    "theme":            "dark",
    "diarize_enabled":  False,
    "diarize_threshold": 0.35,    # 余弦距离阈值（0~1），越小越严格
    "diarize_auto":     True,     # LLM 完成后自动触发说话人识别
    "debug_output":     False,    # 是否将各阶段中间结果保存为 JSON 到 ~/Downloads
    # 高级参数：集中管理当前版本中 ASR / LLM 流程里原本写死的数值。
    "advanced_params": {
        "asr_temperature": 0.0,
        "asr_condition_on_previous_text": False,
        "asr_no_speech_threshold": 0.45,
        "asr_compression_ratio_threshold": 1.8,
        "asr_logprob_threshold": -1.0,
        "asr_fp16": True,
        "llm_temperature": 0.0,
        "llm_context_prompt_max_chars": 300,
        "llm_phase1_chunk_max_chars": 350,
        "llm_phase1_max_tokens": 1200,
        "llm_phase1_min_length_ratio": 0.5,
        "llm_phase2_base_max_tokens": 1200,
        "llm_phase2_tokens_per_target_lang": 600,
        "llm_translate_base_tokens": 800,
        "llm_translate_tokens_per_target_lang": 350,
        "llm_translate_max_tokens_cap": 2400,
        "llm_model_profile": "auto",
    },
    "advanced_presets": [],
}

SETTINGS_FILE = Path.home() / ".asroffline_settings.json"

def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    if SETTINGS_FILE.exists():
        try:
            saved = json.loads(SETTINGS_FILE.read_text())
            # v0.4f 起仅保留 Whisper；兼容旧版配置文件中的废弃字段。
            obsolete_keys = ("sense" + "voice_repo", "asr_" + "backend", "diarize")
            for k in obsolete_keys:
                saved.pop(k, None)
            # advanced_params 使用深度合并，避免旧配置文件缺少新增字段。
            if isinstance(saved.get("advanced_params"), dict):
                adv = dict(s.get("advanced_params", {}))
                adv.update(saved.get("advanced_params") or {})
                # v0.6d: migrate values that merely came from the previous built-in defaults.
                # This keeps existing installations aligned with the new defaults while
                # preserving other user-customized advanced parameters.
                old_defaults = {
                    "asr_condition_on_previous_text": True,
                    "asr_no_speech_threshold": 0.8,
                    "asr_compression_ratio_threshold": 2.4,
                    "asr_logprob_threshold": -0.5,
                }
                for _k, _old in old_defaults.items():
                    if adv.get(_k) == _old:
                        adv[_k] = DEFAULT_SETTINGS["advanced_params"][_k]
                saved["advanced_params"] = adv
            s.update(saved)
        except Exception:
            pass
    return s

def save_settings(s: dict):
    SETTINGS_FILE.write_text(json.dumps(
        {k: v for k, v in s.items() if k != "translate_map"}, indent=2))

def _clear_current_session(remove_audio: bool = True):
    """Clear per-file/session state while preserving models and user settings."""
    old_audio = G.job_audio_path
    G.job_status = "idle"
    G.job_entries = []
    G.job_file_info = {}
    G.job_audio_path = ""
    G.job_raw_text = ""
    G.job_segments = []
    G.job_gaps = []
    G.job_duration = 0.0
    G.job_diarize_cache_key = ""
    G.pending_translate = False
    if remove_audio and old_audio:
        for path in (old_audio, old_audio + ".wav", old_audio + ".mp3"):
            try:
                if Path(path).exists():
                    os.unlink(path)
            except Exception:
                pass

# ── ModelWorker ───────────────────────────────────────────────
from multiprocessing import Queue, Process

class ModelWorker:
    def __init__(self, whisper_repo, llm_repo):
        from model_worker import worker_main
        self.task_q   = Queue(maxsize=4)
        self.result_q = Queue(maxsize=1024)  # 足够容纳大量 translate_done + job_progress 结果
        self._proc    = Process(
            target=worker_main,
            args=(self.task_q, self.result_q, whisper_repo, llm_repo),
            daemon=True,
        )
        self._proc.start()

    def send(self, task: dict):
        try:
            self.task_q.put(task, timeout=10)
        except Exception:
            print("[Worker] 队列满，任务丢弃", flush=True)

    def recv_nowait(self):
        try:
            return self.result_q.get_nowait()
        except Exception:
            return None

    def stop(self):
        self._proc.terminate()
        try: self.task_q.put_nowait(None)
        except Exception: pass
        self._proc.join(timeout=2)
        if self._proc.is_alive():
            self._proc.kill(); self._proc.join(timeout=1)
        for q in (self.task_q, self.result_q):
            try: q.close(); q.join_thread()
            except Exception: pass

def ensure_worker(restart=False):
    with G._worker_lock:
        if G.worker and not restart:
            if getattr(G.worker,"_proc",None) and G.worker._proc.is_alive():
                return
        old = G.worker; G.worker = None; G.worker_ready = False
        if old: old.stop()
        s = G.settings
        G.worker = ModelWorker(
            whisper_repo = s.get("whisper_repo", DEFAULT_SETTINGS["whisper_repo"]),
            llm_repo     = s.get("llm_repo",     DEFAULT_SETTINGS["llm_repo"]),
        )

# ── 任务 ID ───────────────────────────────────────────────────
_task_id_counter = 0
_task_id_lock    = threading.Lock()
def next_tid() -> int:
    global _task_id_counter
    with _task_id_lock:
        _task_id_counter += 1
        return _task_id_counter

# ── 自动翻译：LLM/diarize 完成后立即触发 ─────────────────────
def _enqueue_auto_translate(entries: list):
    """
    将仍缺翻译的 entry 送入 worker 队列补充翻译。
    Phase 2 LLM 已同步翻译的语言会被跳过，只补充缺失语言。
    目标语言：优先用 G.settings["translate_to"]，若未配置则默认中/英/日。
    该函数在 result_receiver 线程中调用，worker 已就绪时才执行。
    """
    if not G.worker or not entries:
        return
    tmap     = G.settings.get("translate_map", {
        "中文":"Chinese","英文":"English","日文":"Japanese",
        "韩文":"Korean","法文":"French","德文":"German","西班牙文":"Spanish",
    })
    langs_cn = G.settings.get("translate_to", [])
    if not langs_cn:
        return   # 没有目标语言，不翻译（Phase 2 不翻译时也不做默认翻译）
    translate_to_all = [tmap.get(l, l) for l in langs_cn]
    count = 0
    for idx, e in enumerate(entries):
        text = e.get("corrected") or e.get("text") or ""
        if not text.strip():
            continue
        existing = set((e.get("translations") or {}).keys())
        # 只翻译尚未有结果的目标语言
        missing = [lang for lang in translate_to_all if lang not in existing]
        if not missing:
            continue
        tid = next_tid()
        G.worker.send({
            "kind":         "translate_entry",
            "task_id":      tid,
            "entry_id":     idx,
            "text":         text,
            "src_lang":     e.get("language", ""),
            "translate_to": missing,
            "advanced_params": G.settings.get("advanced_params", DEFAULT_SETTINGS["advanced_params"]),
        })
        count += 1
    if count:
        print(f"[Auto-translate] queued {count} entries (补充缺失语言) → {translate_to_all}", flush=True)
        broadcast_sync({
            "type":  "translate_started",
            "count": count,
            "langs": langs_cn,
        })
    else:
        print(f"[Auto-translate] 所有 entry 翻译已由 Phase 2 完成，无需补充", flush=True)


# ── 结果接收线程 ──────────────────────────────────────────────
def result_receiver():
    while True:
        worker = G.worker
        if not worker:
            time.sleep(0.04)
            continue
        msg = worker.recv_nowait()
        if msg is None:
            time.sleep(0.02)   # 队列空时短暂休眠，有消息时立即处理下一条
            continue
        t = msg.get("type")

        if t == "status":
            phase = msg.get("phase", "")
            was_ready = G.worker_ready
            G.worker_ready = bool(msg.get("ready", False))
            broadcast_sync({
                "type":  "status",
                "phase": phase,
                "text":  msg.get("text",""),
                "ready": msg.get("ready", False),
            })
            # 若 ASO 加载时 worker 尚未就绪，等就绪后补翻译
            if G.worker_ready and not was_ready and G.pending_translate:
                G.pending_translate = False
                _enqueue_auto_translate(G.job_entries)

        elif t == "job_progress":
            # In-progress updates (e.g. LLM chunk N/M) — don't touch ready state.
            # preview_* fields are visual-only text streams for the front-end sci-fi panel.
            payload = {
                "type":  "phase_update",
                "phase": msg.get("phase",""),
                "pct":   msg.get("pct", 50),
                "msg":   msg.get("msg",""),
            }
            for k in ("preview_stage", "preview_text", "preview_append", "preview_clear",
                      "preview_replace_last"):
                if k in msg:
                    payload[k] = msg.get(k)
            broadcast_sync(payload)

        elif t == "asr_done":
            G.job_raw_text  = msg.get("raw","")
            G.job_segments  = msg.get("segments",[])
            G.job_gaps      = msg.get("gaps",[])
            G.job_duration  = msg.get("duration",0.0)
            G.job_status    = "llm"
            asr_ms = msg.get("asr_ms", 0)
            broadcast_sync({
                "type": "phase_update",
                "phase": "llm",
                "msg":   f"ASR 完成（{asr_ms}ms），LLM 纠错中…",
                "pct":   50,
                # ASR 展示文字已由 worker 按 20 秒音频区间分批发送；
                # 这里不再一次性覆盖 sci-fi preview，避免长文本瞬间刷屏。
                "preview_stage": "p1",
                "preview_clear": True,
            })
            # 自动推进到 LLM
            tid = next_tid()
            # 将 sidebar 的翻译目标语言（中文名→英文名）传给 worker，Phase 2 同步翻译
            tmap_llm = G.settings.get("translate_map", {
                "中文":"Chinese","英文":"English","日文":"Japanese",
                "韩文":"Korean","法文":"French","德文":"German","西班牙文":"Spanish",
            })
            langs_cn_llm  = G.settings.get("translate_to", [])
            translate_to_llm = [tmap_llm.get(l, l) for l in langs_cn_llm]

            G.worker.send({
                "kind":           "llm_correct",
                "debug_output":   G.settings.get("debug_output", False),
                "task_id":        tid,
                "raw":            G.job_raw_text,
                "segments":       G.job_segments,
                "gaps":           G.job_gaps,
                "duration":       G.job_duration,
                "context_prompt": G.settings.get("context_prompt",""),
                "translate_to":   translate_to_llm,   # Phase 2 同步翻译目标语言
                "advanced_params": G.settings.get("advanced_params", DEFAULT_SETTINGS["advanced_params"]),
            })

        elif t == "llm_done":
            entries = msg.get("entries", [])
            if not isinstance(entries, list):
                entries = []
            G.job_entries = entries
            llm_ms = msg.get("llm_ms", 0)

            # ── LLM done：先进入 review，再启动补翻译 ────────────────
            # 之前补翻译 translate_started 可能先于 llm_done 到达前端；在某些
            # pywebview/Chromium 时序下，科幻展示层会保持在 Phase II，导致
            # 已完成的字幕卡片和 playback 没有及时切换出来。这里改为：
            #   1) 若无需自动 diarization，立即把后端状态设为 review 并广播 llm_done；
            #   2) 随后再排队缺失翻译。
            # 这样 /api/status 轮询和 WebSocket 都能可靠触发 showReview()。
            if G.settings.get("diarize_enabled") and G.settings.get("diarize_auto", True) \
               and G.job_audio_path and entries:
                # 做说话人识别时仍然先保持处理阶段；补翻译可以并行启动。
                _enqueue_auto_translate(entries)
                G.job_status = "diarize"
                G.job_diarize_cache_key = G.job_audio_path  # 新录音，不复用缓存
                broadcast_sync({
                    "type":  "phase_update",
                    "phase": "diarize",
                    "pct":   5,
                    "msg":   f"LLM 完成（{llm_ms}ms），翻译已启动，说话人识别中…",
                    "preview_stage": "diarize",
                    "preview_text": "Speaker fingerprint analysis...\nKeeping Phase II language stream visible while diarization runs.",
                    "preview_append": True,
                })
                tid = next_tid()
                G.worker.send({
                    "kind":       "diarize",
                    "debug_output": G.settings.get("debug_output", False),
                    "task_id":    tid,
                    "audio_path": G.job_audio_path,
                    "entries":    list(entries),
                    "threshold":  float(G.settings.get("diarize_threshold", 0.35)),
                    "cache_key":  G.job_diarize_cache_key,
                })
            else:
                # 不做说话人识别，直接进入校对阶段；字幕卡片/playback 优先显示。
                G.job_status = "review"
                broadcast_sync({
                    "type":      "llm_done",
                    "phase":     "review",
                    "msg":       f"完成（{llm_ms}ms）",
                    "pct":       100,
                    "entries":   entries,
                    "n_entries": len(entries),
                    "segments":  G.job_segments,
                    "raw_text":  G.job_raw_text,
                    "error":     msg.get("error", ""),
                    "diarize_running": False,
                })
                # 补缺失语言翻译不应阻塞 review 界面显示。
                _enqueue_auto_translate(entries)

        elif t == "diarize_done":
            entries = msg.get("entries", [])
            if not isinstance(entries, list):
                entries = []
            G.job_entries = entries
            G.job_status = "review"
            n_spk = msg.get("n_speakers", 0)
            thr   = msg.get("threshold", G.settings.get("diarize_threshold", 0.35))
            err   = msg.get("error", "")
            if err:
                print(f"[Diarize ERROR] {err}", flush=True)
            broadcast_sync({
                "type":       "diarize_done",
                "phase":      "review",
                "pct":        100,
                "entries":    entries,
                "n_entries":  len(entries),
                "n_speakers": n_spk,
                "threshold":  thr,
                "segments":   G.job_segments,
                "raw_text":   G.job_raw_text,
                "error":      err,
            })
            # 翻译已在 LLM done 阶段提前启动，此处无需重复触发
            # _enqueue_auto_translate(entries)  ← 已移至 llm_done 阶段

        elif t == "translate_done":
            eid = msg.get("entry_id")
            translations = msg.get("translations", {}) or {}
            preview_text = ""
            preview_log = ""
            try:
                eid_int = int(eid) if eid is not None else None
            except Exception:
                eid_int = None
            try:
                if eid_int is not None and 0 <= eid_int < len(G.job_entries):
                    entry = G.job_entries[eid_int]
                    entry["translations"] = translations
                    base = (entry.get("corrected") or entry.get("text") or "").strip()
                    lines = []
                    if base:
                        lines.append(base)
                    if isinstance(translations, dict) and translations:
                        for lang, txt in translations.items():
                            if txt:
                                lines.append(f"{lang}: {txt}")
                    else:
                        lines.append("[translation returned; no parsed translation fields]")
                    preview_text = "\n".join(lines)
                    preview_log = f"[LLM TRANSLATE-{eid_int}] completed translations={len(translations) if isinstance(translations, dict) else 0}"
            except Exception:
                pass
            broadcast_sync({
                "type":         "translate_done",
                "entry_id":     eid,
                "translations": translations,
                # Visual-only fields for the front-end sci-fi panel. They do not
                # affect ASO data, export, timestamps, or subtitle content.
                "preview_stage": "p2",
                "preview_text":  preview_text,
                "preview_log":   preview_log,
            })

        elif t == "error":
            G.job_status = "error"
            broadcast_sync({"type":"error","msg": msg.get("msg","")})

# ── WebSocket 广播 ────────────────────────────────────────────
def _json_safe(obj):
    """Convert worker results into values that FastAPI/WebSocket JSON can send.

    Some ASR/LLM timing values may arrive as numpy scalar types.  If send_json()
    fails on one such value, the frontend receives no llm_done event and the
    subtitle cards never render, even though the worker has completed.
    """
    try:
        import numpy as _np
        if isinstance(obj, _np.generic):
            return obj.item()
        if isinstance(obj, _np.ndarray):
            return obj.tolist()
    except Exception:
        pass
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(v) for v in obj]
    if isinstance(obj, float):
        if obj != obj or obj in (float('inf'), float('-inf')):
            return None
        return obj
    if isinstance(obj, (str, int, bool)) or obj is None:
        return obj
    return str(obj)

def broadcast_sync(msg: dict):
    global _main_loop
    try:
        if _main_loop and _main_loop.is_running() and G.ws_clients:
            fut = asyncio.run_coroutine_threadsafe(_broadcast(_json_safe(msg)), _main_loop)
            def _log_done(f):
                try:
                    exc = f.exception()
                    if exc:
                        print(f"[WS BROADCAST ERROR] {exc}", flush=True)
                except Exception:
                    pass
            fut.add_done_callback(_log_done)
    except Exception as e:
        print(f"[WS SCHEDULE ERROR] {e}", flush=True)

async def _broadcast(msg: dict):
    msg = _json_safe(msg)
    dead = []
    for ws in list(G.ws_clients):
        try:
            await ws.send_json(msg)
        except Exception as e:
            print(f"[WS SEND ERROR] {e}", flush=True)
            dead.append(ws)
    for ws in dead:
        if ws in G.ws_clients: G.ws_clients.remove(ws)

# ── 本地模型扫描 ──────────────────────────────────────────────
def scan_local_models() -> dict:
    result = {"whisper":[], "llm":[]}
    exts   = (".safetensors",".bin",".npz")
    def _cached(p):
        if any(f.suffix in exts for f in p.iterdir() if f.is_file()):
            return True
        snaps = p/"snapshots"
        if snaps.is_dir():
            for s in snaps.iterdir():
                if s.is_dir() and any(f.suffix in exts
                                      for f in s.iterdir() if f.is_file()):
                    return True
        return False
    for base in [
        Path.home()/".cache"/"huggingface"/"hub",
        Path.home()/".cache"/"modelscope"/"hub",
    ]:
        if not base.is_dir(): continue
        for d in base.iterdir():
            if not d.is_dir() or not d.name.startswith("models--"): continue
            repo = d.name[len("models--"):].replace("--","/")
            try:
                if not _cached(d): continue
            except Exception:
                continue
            rl = repo.lower()
            if "whisper"      in rl: result["whisper"].append(repo)
            elif any(x in rl for x in ["qwen","llama","gemma","mistral",
                                        "phi","deepseek"]):
                result["llm"].append(repo)
    return result

# ── MP3 / 音频检查 ────────────────────────────────────────────
async def _check_audio(path: str) -> dict:
    """用 ffprobe 检查音频文件基本信息，返回 {ok, duration, format, bitrate, error}"""
    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json",
           "-show_format", "-show_streams", path]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        return {"ok": False, "error": stderr.decode()[:200]}
    try:
        info    = json.loads(stdout)
        fmt     = info.get("format", {})
        streams = info.get("streams", [])
        audio   = next((s for s in streams if s.get("codec_type")=="audio"), {})
        duration = float(fmt.get("duration", 0))
        bitrate  = int(fmt.get("bit_rate", 0)) // 1000
        codec    = audio.get("codec_name","unknown")
        sr       = int(audio.get("sample_rate", 0))
        ch       = int(audio.get("channels", 0))
        return {
            "ok":       True,
            "duration": round(duration, 1),
            "format":   fmt.get("format_long_name",""),
            "codec":    codec,
            "bitrate":  bitrate,
            "sample_rate": sr,
            "channels": ch,
            "size_mb":  round(int(fmt.get("size",0))/1024/1024, 1),
        }

    except Exception as e:
        return {"ok": False, "error": str(e)}


async def _convert_source_audio_to_pcm(source_path: str, display_filename: str | None = None) -> dict:
    """
    将一个可解码的原始音频文件转换为当前 job 使用的 16kHz mono f32 临时文件。

    正常 /api/upload 的链路是：
      原始 mp3/音频 → 临时原始文件 → ffmpeg 转 16k mono f32 → G.job_audio_path
      /api/audio 再把这个 f32 临时文件转成 WAV 返回给前端播放器。

    ASO 自动配对音频也必须走同一条链路，而不是直接把 mp3 塞给播放器，
    否则 MP3 encoder delay/padding 可能导致 playback 与字幕时间戳错位。
    """
    src = Path(source_path)
    info = await _check_audio(str(src))
    if not info.get("ok"):
        return {"ok": False, "error": info.get("error", "解码失败")}

    tmp_pcm = tempfile.NamedTemporaryFile(suffix=".f32", delete=False)
    tmp_pcm.close()
    cmd = ["ffmpeg", "-y", "-i", str(src),
           "-ar", "16000", "-ac", "1", "-f", "f32le", tmp_pcm.name]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL)
    await proc.wait()

    if proc.returncode != 0:
        try: os.unlink(tmp_pcm.name)
        except Exception: pass
        return {"ok": False, "error": "ffmpeg 转换失败"}

    old_audio = G.job_audio_path
    if old_audio and Path(old_audio).exists():
        try: os.unlink(old_audio)
        except Exception: pass
    for ext in (".mp3", ".wav"):
        cache = (old_audio or "") + ext
        if cache and Path(cache).exists():
            try: os.unlink(cache)
            except Exception: pass

    G.job_audio_path = tmp_pcm.name
    G.job_file_info  = {**info, "filename": display_filename or src.name}
    return {"ok": True, "info": G.job_file_info}


def _find_audio_next_to_aso(aso_path: str, source_audio: dict) -> str:
    """根据 ASO 路径和 ASO 中记录的 source_audio.filename，在同目录查找原始音频。"""
    if not aso_path or not source_audio:
        return ""
    try:
        base = Path(aso_path).expanduser().resolve().parent
    except Exception:
        return ""
    filename = (source_audio.get("filename") or "").strip()
    if not filename:
        return ""
    candidate = base / filename
    if candidate.exists() and candidate.is_file():
        return str(candidate)

    # 容错：大小写不一致或 macOS/Finder 改名时，先按文件名大小写不敏感匹配。
    target = filename.lower()
    try:
        for p in base.iterdir():
            if p.is_file() and p.name.lower() == target:
                return str(p)
    except Exception:
        pass
    return ""

# ── Lifespan ──────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _main_loop
    _main_loop = asyncio.get_event_loop()
    G.settings = load_settings()
    threading.Thread(target=result_receiver, daemon=True).start()
    threading.Thread(target=lambda: ensure_worker(), daemon=True).start()
    yield
    # 清理临时文件
    if G.job_audio_path:
        for path in (G.job_audio_path, G.job_audio_path + ".wav", G.job_audio_path + ".mp3"):
            if Path(path).exists():
                try: os.unlink(path)
                except Exception: pass
    if G.worker: G.worker.stop()

# ── FastAPI ───────────────────────────────────────────────────
def create_app() -> FastAPI:
    app = FastAPI(title="Lancer1911 ASR Offline", lifespan=lifespan)
    app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")

    _H1 = hashlib.sha256("Lancer1911".encode()).hexdigest()

    @app.get("/ping")
    def ping(): return {"ok": True}

    @app.get("/api/author")
    def author_token(): return {"token": _H1}

    @app.get("/api/models")
    def api_models(): return JSONResponse(scan_local_models())

    @app.get("/api/settings")
    def api_get_settings(): return JSONResponse(G.settings)

    @app.get("/api/settings_defaults")
    def api_settings_defaults(): return JSONResponse(DEFAULT_SETTINGS)

    @app.post("/api/settings")
    async def api_save_settings(req: dict):
        prev = dict(G.settings)
        G.settings.update(req)
        save_settings(G.settings)
        MODEL_KEYS = {"whisper_repo","llm_repo"}
        if {k: prev.get(k) for k in MODEL_KEYS} != \
           {k: G.settings.get(k) for k in MODEL_KEYS}:
            await asyncio.to_thread(ensure_worker, True)
        else:
            await _broadcast({"type":"status","phase":"ready",
                               "text":"就绪","ready":True})
        return {"ok": True}

    @app.post("/api/upload")
    async def api_upload(file: UploadFile = File(...)):
        """上传音频文件 → 检查 → 返回文件信息，等待用户确认开始"""
        if G.job_status in ("asr","llm"):
            return JSONResponse({"error":"正在处理中，请等待完成"},status_code=409)

        suffix   = Path(file.filename or "audio.mp3").suffix or ".mp3"
        tmp_orig = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp_orig.close()
        # 避免大文件一次性读入内存，按块写入临时文件。
        with open(tmp_orig.name, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)

        # 检查音频
        G.job_status = "checking"
        info = await _check_audio(tmp_orig.name)
        if not info["ok"]:
            os.unlink(tmp_orig.name)
            G.job_status = "idle"
            return JSONResponse({"ok":False,"error":info.get("error","解码失败")})

        # 转换为 16kHz mono f32 临时文件（供后续 ASR 使用）
        tmp_pcm  = tempfile.NamedTemporaryFile(suffix=".f32", delete=False)
        tmp_pcm.close()
        cmd = ["ffmpeg","-y","-i",tmp_orig.name,
               "-ar","16000","-ac","1","-f","f32le", tmp_pcm.name]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL)
        await proc.wait()
        os.unlink(tmp_orig.name)

        if proc.returncode != 0:
            os.unlink(tmp_pcm.name)
            G.job_status = "idle"
            return JSONResponse({"ok":False,"error":"ffmpeg 转换失败"})

        # 清理上一个临时文件及其 mp3 缓存
        if G.job_audio_path and Path(G.job_audio_path).exists():
            try: os.unlink(G.job_audio_path)
            except Exception: pass
        for suffix in (".mp3", ".wav"):
            cache = (G.job_audio_path or "") + suffix
            if cache and Path(cache).exists():
                try: os.unlink(cache)
                except Exception: pass

        G.job_audio_path = tmp_pcm.name
        G.job_file_info  = {**info, "filename": file.filename}
        G.job_status     = "ready"
        G.job_entries    = []
        G.job_raw_text   = ""
        G.job_segments   = []
        G.job_gaps       = []
        G.job_duration   = 0.0

        await _broadcast({"type":"file_ready","info": G.job_file_info})
        return {"ok": True, "info": G.job_file_info}

    @app.post("/api/pair_audio")
    async def api_pair_audio(file: UploadFile = File(...)):
        """为已加载的 ASO 会话配对音频，仅供播放/跟随使用，不清空字幕。"""
        if G.job_status in ("asr", "llm"):
            return JSONResponse({"error":"正在处理中，请等待完成"}, status_code=409)

        suffix   = Path(file.filename or "audio.mp3").suffix or ".mp3"
        tmp_orig = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp_orig.close()
        with open(tmp_orig.name, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)

        result = await _convert_source_audio_to_pcm(tmp_orig.name, file.filename)
        try: os.unlink(tmp_orig.name)
        except Exception: pass
        if not result.get("ok"):
            return JSONResponse({"ok":False,"error":result.get("error","音频加载失败")}, status_code=400)

        if G.job_entries:
            G.job_status = "review"

        await _broadcast({"type":"audio_paired","info": G.job_file_info})
        return {"ok": True, "info": G.job_file_info}

    @app.post("/api/start")
    async def api_start():
        """用户确认后启动 ASR"""
        if G.job_status != "ready":
            return JSONResponse({"error":"请先上传文件"}, status_code=400)
        if not G.worker:
            return JSONResponse({"error":"模型未就绪"}, status_code=503)

        G.job_status  = "asr"
        G.job_entries = []
        G.job_raw_text = ""
        G.job_segments = []
        G.job_gaps = []
        await _broadcast({"type":"phase_update","phase":"asr",
                          "msg":"Whisper ASR 转录中…","pct":10})
        tid = next_tid()
        # 仅传递临时文件路径，避免把整段 f32 音频复制进 multiprocessing Queue。
        G.worker.send({
            "kind":         "asr",
            "task_id":      tid,
            "audio_path":   G.job_audio_path,
            "asr_language": G.settings.get("asr_language") or None,
            "debug_output": G.settings.get("debug_output", False),
            "advanced_params": G.settings.get("advanced_params", DEFAULT_SETTINGS["advanced_params"]),
        })
        return {"ok":True}

    @app.post("/api/translate_entry")
    async def api_translate_entry(req: dict):
        """用户手动触发单句翻译"""
        if not G.worker:
            return JSONResponse({"error":"模型未就绪"}, status_code=503)
        tmap     = G.settings.get("translate_map",{})
        # 允许前端直接传 translate_to（中文语言名列表），优先使用
        langs_cn = req.get("translate_to") or G.settings.get("translate_to",[])
        translate_to = [tmap.get(l,l) for l in langs_cn]
        if not translate_to:
            return JSONResponse({"error":"未设置翻译目标语言"}, status_code=400)
        tid = next_tid()
        G.worker.send({
            "kind":         "translate_entry",
            "task_id":      tid,
            "entry_id":     req.get("entry_id",0),
            "text":         req.get("text",""),
            "src_lang":     req.get("src_lang",""),
            "translate_to": translate_to,
            "advanced_params": G.settings.get("advanced_params", DEFAULT_SETTINGS["advanced_params"]),
        })
        return {"ok":True}

    @app.post("/api/translate_all")
    async def api_translate_all(req: dict = None):
        """批量翻译全部 entry；逐条送入 worker，前端通过 translate_done 实时更新。
        Body（可选）: {"translate_to": ["中文","英文","日文"]} 直接指定目标语言，
        否则从 G.settings 读取。两种方式都会同步更新 G.settings。
        """
        if not G.worker:
            return JSONResponse({"error":"模型未就绪"}, status_code=503)
        tmap = G.settings.get("translate_map",{})
        # 优先使用请求体中的语言列表
        req = req or {}
        langs_cn = req.get("translate_to") or G.settings.get("translate_to",[])
        if not langs_cn:
            # 最终降级：默认中英日
            langs_cn = ["中文", "英文", "日文"]
        translate_to = [tmap.get(l,l) for l in langs_cn]
        # 同步更新 settings，让后续 translate_entry 也能使用
        G.settings["translate_to"] = langs_cn
        save_settings(G.settings)
        # 重新翻译时以当前目标语言为准，先清空旧译文，避免旧语言残留到 ASO 或界面。
        if req.get("replace", True):
            for e in G.job_entries:
                if isinstance(e, dict):
                    e["translations"] = {}
        # 先统计总数，立即广播 translate_started，让前端进度条早于任务入队就绪
        tasks = []
        for idx, e in enumerate(G.job_entries):
            text = e.get("corrected") or e.get("text") or ""
            if not text.strip():
                continue
            tasks.append((idx, e, text))
        count = len(tasks)
        if count:
            await _broadcast({
                "type":  "translate_started",
                "count": count,
                "langs": langs_cn,
            })
        # 逐条入队，每隔一条 await asyncio.sleep(0) 让出 event loop，
        # 确保 result_receiver 线程的 broadcast_sync future 能及时执行，
        # 前端进度条得以实时推进（避免 task_q 满时阻塞整个 event loop）。
        loop = asyncio.get_event_loop()
        for i, (idx, e, text) in enumerate(tasks):
            tid = next_tid()
            await loop.run_in_executor(None, G.worker.send, {
                "kind":         "translate_entry",
                "task_id":      tid,
                "entry_id":     idx,
                "text":         text,
                "src_lang":     e.get("language", ""),
                "translate_to": translate_to,
                "advanced_params": G.settings.get("advanced_params", DEFAULT_SETTINGS["advanced_params"]),
            })
            if i % 4 == 3:
                await asyncio.sleep(0)   # 让出 event loop，允许 WS 消息发出
        return {"ok": True, "count": count}


    @app.post("/api/diarize")
    async def api_diarize(req: dict = None):
        """手动触发说话人识别（或在调整 threshold 后重新运行）。
        Body: {"threshold": 0.35, "recluster_only": false}
        recluster_only=true 时复用声纹嵌入缓存，仅重新聚类（快速）。
        """
        if not G.worker:
            return JSONResponse({"error": "模型未就绪"}, status_code=503)
        if G.job_status in ("asr", "llm", "diarize"):
            return JSONResponse({"error": "正在处理中，请等待完成"}, status_code=409)
        if not G.job_entries:
            return JSONResponse({"error": "请先完成 ASR 和 LLM 纠错"}, status_code=400)
        if not G.job_audio_path or not Path(G.job_audio_path).exists():
            return JSONResponse({"error": "音频文件不存在，请重新上传"}, status_code=400)

        req = req or {}
        threshold     = float(req.get("threshold", G.settings.get("diarize_threshold", 0.35)))
        recluster_only = bool(req.get("recluster_only", False))

        # 更新设置中的 threshold
        G.settings["diarize_threshold"] = threshold
        save_settings(G.settings)

        G.job_status = "diarize"
        # recluster_only 时保留 cache_key（复用嵌入），否则用新 key 强制重新提取
        if not recluster_only:
            G.job_diarize_cache_key = G.job_audio_path + f"_{time.time()}"

        await _broadcast({"type": "phase_update", "phase": "diarize",
                          "pct": 5, "msg": "说话人识别中…"})
        tid = next_tid()
        G.worker.send({
            "kind":       "diarize",
                    "debug_output": G.settings.get("debug_output", False),
            "task_id":    tid,
            "audio_path": G.job_audio_path,
            "entries":    list(G.job_entries),
            "threshold":  threshold,
            "cache_key":  G.job_diarize_cache_key,
        })
        return {"ok": True, "threshold": threshold, "recluster_only": recluster_only}

    @app.post("/api/diarize_rename")
    async def api_diarize_rename(req: dict):
        """重命名说话人标签（前端直接批量修改 entries）。
        Body: {"old_name": "SPEAKER_1", "new_name": "张三"}
        """
        old = req.get("old_name", "")
        new = req.get("new_name", "").strip()
        if not old or not new:
            return JSONResponse({"error": "缺少参数"}, status_code=400)
        count = 0
        for e in G.job_entries:
            if e.get("speaker") == old:
                e["speaker"] = new
                count += 1
        await _broadcast({"type": "speaker_renamed", "old": old, "new": new, "count": count})
        return {"ok": True, "renamed": count}

    @app.get("/api/has_dialog")
    def api_has_dialog():
        """
        前端用于检测是否运行在 pywebview 模式。
        pywebview 模式下 window.pywebview.api 可用，前端直接调用 js_api 弹对话框。
        """
        # 总是返回 false：文件对话框由前端通过 window.pywebview.api 直接调用，
        # 无需服务端中转。此接口保留供兼容性检测。
        return {"has_dialog": False, "use_jsapi": True}

    @app.post("/api/load_session")
    async def api_load_session(req: dict):
        """
        加载 ASO 会话文件内容，恢复 entries、settings 和音频元信息。
        Body: {"content": "<json string>"}
        """
        content = req.get("content", "")
        aso_path = (req.get("aso_path") or "").strip()
        try:
            payload = json.loads(content)
        except Exception as e:
            return JSONResponse({"error": f"JSON 解析失败: {e}"}, status_code=400)

        entries  = payload.get("entries", [])
        settings = payload.get("settings", {})

        if not isinstance(entries, list):
            return JSONResponse({"error": "无效的会话文件"}, status_code=400)

        G.job_entries = entries
        G.job_status  = "review"

        # 恢复 ASO 中保存的调试面板数据（ASR 原文、segments、时间戳对比的基础数据）
        debug = payload.get("debug", {}) if isinstance(payload.get("debug", {}), dict) else {}
        G.job_raw_text = debug.get("asr_raw_text") or payload.get("raw_text") or ""
        segs = debug.get("asr_segments") if "asr_segments" in debug else payload.get("segments", [])
        G.job_segments = segs if isinstance(segs, list) else []
        G.job_gaps = payload.get("gaps", []) if isinstance(payload.get("gaps", []), list) else []

        # 恢复设置（可选，不覆盖模型路径）
        for k in ("translate_to", "context_prompt", "diarize_enabled",
                  "diarize_threshold", "diarize_auto"):
            if k in settings:
                G.settings[k] = settings[k]

        # 恢复音频元信息（ASO 保存时写入的 source_audio 字段）
        source_audio = payload.get("source_audio", {})
        auto_audio_paired = False
        auto_audio_error = ""
        if source_audio:
            G.job_file_info = source_audio
            # 旧会话中的临时音频路径已失效；尝试在 ASO 同目录自动找到原始音频并按正常链路重建 f32。
            G.job_audio_path = ""
            local_audio = _find_audio_next_to_aso(aso_path, source_audio)
            if local_audio:
                result = await _convert_source_audio_to_pcm(local_audio, source_audio.get("filename"))
                auto_audio_paired = bool(result.get("ok"))
                if not auto_audio_paired:
                    auto_audio_error = result.get("error", "音频自动加载失败")

        has_audio = bool(G.job_audio_path and Path(G.job_audio_path).exists())

        await _broadcast({
            "type":        "session_loaded",
            "entries":     entries,
            "settings":    G.settings,
            "n":           len(entries),
            "has_audio":   has_audio,
            "source_audio": source_audio,   # 原始音频元信息，前端用于提示配对
            "segments":   G.job_segments,
            "raw_text":   G.job_raw_text,
            "auto_audio_paired": auto_audio_paired,
            "auto_audio_error": auto_audio_error,
        })

        # Bug 2 fix: 补充缺失翻译
        # 若 worker 已就绪则立即发送；否则设置标志，等 worker 预热完成后自动补发
        if G.settings.get("translate_to"):
            if G.worker and G.worker_ready:
                _enqueue_auto_translate(entries)
            else:
                G.pending_translate = True  # result_receiver 的 status 处理会补发

        return {"ok": True, "n": len(entries)}

    @app.post("/api/new_session")
    async def api_new_session():
        """用户点击“新文件”时清空当前会话、音频和调试数据，但不重启模型。"""
        _clear_current_session(remove_audio=True)
        await _broadcast({
            "type": "job_status",
            "status": "idle",
            "msg": "已清空",
            "entries": [],
            "segments": [],
            "raw_text": "",
        })
        return {"ok": True}

    @app.post("/api/cancel")
    async def api_cancel():
        """中断当前 ASR/LLM 任务：重启模型子进程并清空当前处理状态。"""
        _clear_current_session(remove_audio=True)
        await asyncio.to_thread(ensure_worker, True)
        await _broadcast({"type":"job_status","status":"idle","msg":"已取消"})
        return {"ok": True}

    @app.post("/api/update_entry")
    async def api_update_entry(req: dict):
        """保存用户手工校对的 entry"""
        idx = req.get("idx")
        if idx is None or idx >= len(G.job_entries):
            return JSONResponse({"error":"invalid idx"}, status_code=400)
        e = G.job_entries[idx]
        if "corrected" in req:
            e["corrected"] = req["corrected"]
        return {"ok":True}

    @app.get("/api/entries")
    def api_entries():
        return JSONResponse(_json_safe(G.job_entries))

    @app.get("/api/file_info")
    def api_file_info():
        """返回当前已上传音频文件的元信息（文件名、时长、编码等），供 ASO 保存使用。"""
        return JSONResponse(_json_safe(G.job_file_info))

    @app.api_route("/api/audio", methods=["GET", "HEAD"])
    async def api_audio(request: Request):
        """返回当前 job 的可播放音频供前端播放器使用。

        同时支持 HEAD（前端检查可用性）和 GET（实际播放）。
        显式添加 Accept-Ranges: bytes，确保 WKWebView / Safari 内核能通过
        HTTP Range 请求精确 seek，避免大文件 Blob URL 的 currentTime 漂移问题。
        WAV 生成命令去掉输出侧多余的 -ar/-ac，避免触发 swr resampler 引入额外延迟。
        """
        from fastapi.responses import FileResponse, Response
        if not G.job_audio_path or not Path(G.job_audio_path).exists():
            return Response(status_code=404)
        tmp_wav = G.job_audio_path + ".wav"
        if not Path(tmp_wav).exists():
            cmd = ["ffmpeg", "-y", "-f", "f32le", "-ar", "16000", "-ac", "1",
                   "-i", G.job_audio_path,
                   "-c:a", "pcm_s16le", tmp_wav]   # 无需再指定输出 -ar/-ac，与输入一致
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL)
            await proc.wait()
        if not Path(tmp_wav).exists():
            return Response(status_code=500)
        size = Path(tmp_wav).stat().st_size
        common_headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(size),
        }
        if request.method == "HEAD":
            return Response(
                headers={**common_headers, "Content-Type": "audio/wav"})
        return FileResponse(tmp_wav, media_type="audio/wav",
                            headers={"Accept-Ranges": "bytes"})

    @app.get("/api/status")
    def api_status():
        return {"status": G.job_status, "n_entries": len(G.job_entries)}

    @app.get("/api/export")
    def api_export(fmt: str = "srt", lang: str = "mixed"):
        """
        fmt:  srt | txt | md | json
        lang: mixed      → 校对后原文 + 所有翻译 + 说话人 + 时间戳
              <语言名>   → 仅输出该语言（原文或对应翻译），含说话人 + 时间戳
                           例：lang=English, lang=Chinese, lang=zh
        """
        if not G.job_entries:
            return JSONResponse({"error":"no entries"}, status_code=404)

        def _pick_text(e: dict) -> str:
            return _pick_lang_text(e, lang)

        if fmt == "srt":
            content = _to_srt(G.job_entries, lang=lang)
        elif fmt == "txt":
            lines = []
            for e in G.job_entries:
                s_ts = _fmt_readable(e.get("start", 0))
                e_ts = _fmt_readable(e.get("end", 0))
                spk  = e.get("speaker", "")
                txt  = _pick_text(e)
                spk_part = f"[{spk}] " if spk else ""
                lines.append(f"{s_ts} → {e_ts}  {spk_part}{txt}")
                if lang == "mixed":
                    for tl, tv in (e.get("translations") or {}).items():
                        lines.append(f"  [{tl}] {tv}")
            content = "\n".join(lines)
        elif fmt == "md":
            lines = []
            for i, e in enumerate(G.job_entries, 1):
                s_ts = _fmt_readable(e.get('start',0))
                e_ts = _fmt_readable(e.get('end',0))
                spk  = e.get("speaker","")
                head = f"### {i}. {s_ts} → {e_ts}" + (f"  `{spk}`" if spk else "")
                lines.append(head)
                lines.append(_pick_text(e))
                if lang == "mixed":
                    for tl, tv in (e.get("translations") or {}).items():
                        lines.append(f"> **{tl}**: {tv}")
                lines.append("")
            content = "\n".join(lines)
        elif fmt == "json":
            return JSONResponse(G.job_entries)
        else:
            return JSONResponse({"error":"unknown format"}, status_code=400)
        return HTMLResponse(content, media_type="text/plain; charset=utf-8")

    @app.get("/", response_class=HTMLResponse)
    async def index():
        p = Path(__file__).parent / "static" / "index.html"
        return HTMLResponse(p.read_text(encoding="utf-8"))

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        G.ws_clients.append(ws)
        await ws.send_json(_json_safe({
            "type":          "init",
            "settings":      G.settings,
            "job_status":    G.job_status,
            "entries":       G.job_entries,
            "worker_ready":  G.worker_ready,
            "file_info":     G.job_file_info,
            "segments":      G.job_segments,
            "raw_text":      G.job_raw_text,
        }))
        try:
            while True:
                data = await ws.receive_json()
                act  = data.get("act")
                if act == "cancel":
                    G.job_status = "idle"
                    await _broadcast({"type":"job_status","status":"idle"})
        except WebSocketDisconnect:
            pass
        finally:
            if ws in G.ws_clients: G.ws_clients.remove(ws)

    return app

# ── SRT 生成 ─────────────────────────────────────────────────
def _fmt_readable(s: float) -> str:
    """Human-readable MM:SS.s timestamp for MD export."""
    m=int(s//60); sec=s%60
    return f"{m}:{sec:04.1f}"

def _ts(s: float) -> str:
    h=int(s//3600); m=int((s%3600)//60); sec=s%60
    return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".",",")

# ── 语言名别名工具（中文名 ↔ 英文名/代码 双向匹配）─────────────
_LANG_ALIASES_MAP: dict = {
    "中文": ["chinese", "zh", "mandarin", "cn"],
    "英文": ["english", "en"],
    "日文": ["japanese", "ja", "jp"],
    "韩文": ["korean", "ko", "kr"],
    "法文": ["french", "fr"],
    "德文": ["german", "de"],
    "西班牙文": ["spanish", "es"],
}
_ALIAS_TO_CN: dict = {alias: cn
                      for cn, aliases in _LANG_ALIASES_MAP.items()
                      for alias in aliases}

def _norm_lang(l: str) -> str:
    """将语言名/代码归一化为中文标准名；未知语言原样返回。"""
    return _ALIAS_TO_CN.get(l.lower().strip(), l)

def _lang_eq(a: str, b: str) -> bool:
    """判断两个语言名是否指同一种语言（跨中英文名/代码）。"""
    a, b = a.lower().strip(), b.lower().strip()
    if a == b or a in b or b in a:
        return True
    return _norm_lang(a) == _norm_lang(b)

def _pick_lang_text(e: dict, lang: str) -> str:
    """从 entry 中按目标语言取文字（支持中英文名/代码互查）。"""
    if lang == "mixed":
        return e.get("corrected") or ""
    trans = e.get("translations") or {}
    for tl, tv in trans.items():
        if _lang_eq(lang, tl):
            return tv
    # 匹配原文语言
    entry_lang = e.get("language") or ""
    if entry_lang and _lang_eq(lang, entry_lang):
        return e.get("corrected") or ""
    return e.get("corrected") or ""


def _to_srt(entries: list, lang: str = "mixed") -> str:
    out = []
    for i, e in enumerate(entries, 1):
        s   = e.get("start", 0.0); end = e.get("end", s + 3.0)
        spk = e.get("speaker", "")
        prefix = f"[{spk}] " if spk else ""

        if lang == "mixed":
            text  = e.get("corrected") or ""
            trans = e.get("translations") or {}
            lines = [prefix + text] if text else []
            for tv in trans.values():
                lines.append(tv)
            text_block = "\n".join(lines)
        else:
            picked     = _pick_lang_text(e, lang)
            text_block = prefix + picked

        if text_block.strip():
            out.append(f"{i}\n{_ts(s)} --> {_ts(end)}\n{text_block}\n")
    return "\n".join(out)
