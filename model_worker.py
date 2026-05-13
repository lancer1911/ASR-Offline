"""
Lancer1911 ASR Offline v0.7a — 模型子进程

架构：Whisper (词级时间戳) → 两阶段 LLM → 字幕条目

两阶段 LLM 流水线：
  Phase 1  轻量纠错（保守）
    - 输入：Whisper ASR 原始 chunk（按停顿切分，~350字）
    - 任务：只修同音/近音字，不切句，不补全半句，不强加标点
    - 输出：纠错后连续文字流（保持原文结构）

  Phase 2  按句重分段 → 精细处理
    - 扫描 Phase 1 输出，按句终标点（。！？）重新划分句子边界
    - 每个句子的 start/end = 其首尾字符在 ASR 词级时间戳中对应的时间
    - 每句再过一次 LLM：加完整标点、最终纠错
    - 时间戳锁定，不再改变

"""
import re, time, json
import os
from datetime import datetime
import numpy as np
from multiprocessing import Queue

# ── 调试输出目录 ─────────────────────────────────────────────────
# ── 调试输出 ──────────────────────────────────────────────────
_OUT_DIR = os.path.join(os.path.expanduser("~"), "Downloads")
os.makedirs(_OUT_DIR, exist_ok=True)

# 调试文件输出开关（由 server 通过任务字段传入；子进程启动后由全局变量控制）
_debug_output_enabled: bool = False

DEFAULT_ADVANCED_PARAMS = {
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
    # v0.7a: model compatibility profile. auto/thinking/legacy.
    # thinking: Qwen3.6-style thinking models; legacy: Qwen3-30B/14B-style instruct models.
    "llm_model_profile": "auto",
}

def _adv(task: dict) -> dict:
    params = dict(DEFAULT_ADVANCED_PARAMS)
    extra = task.get("advanced_params") if isinstance(task, dict) else None
    if isinstance(extra, dict):
        params.update(extra)
    return params

def _clamp_float(v, lo, hi, default):
    try:
        x = float(v)
        if x < lo: return lo
        if x > hi: return hi
        return x
    except Exception:
        return default

def _clamp_int(v, lo, hi, default):
    try:
        x = int(float(v))
        if x < lo: return lo
        if x > hi: return hi
        return x
    except Exception:
        return default

def _fmt_ts(sec: float) -> str:
    h = int(sec // 3600); m = int((sec % 3600) // 60); s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"

def _save_stage(stage: str, data, *, force: bool = False):
    """
    保存某阶段调试信息到 ~/Downloads/asr_<stage>_<timestamp>.json
    默认关闭（_debug_output_enabled=False），force=True 时强制输出。
    data 可以是 dict/list（输出 JSON）或 str（输出纯文本 .txt）。
    """
    if not _debug_output_enabled and not force:
        return
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    if isinstance(data, (dict, list)):
        fn = os.path.join(_OUT_DIR, f"asr_{stage}_{ts}.json")
        with open(fn, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    else:
        fn = os.path.join(_OUT_DIR, f"asr_{stage}_{ts}.txt")
        with open(fn, "w", encoding="utf-8") as f:
            f.write(str(data))
    print(f"[SAVE] {stage} -> {fn}", flush=True)

# ── 음频유틸 ──────────────────────────────────────────────────
def _prepare_audio(audio: np.ndarray) -> np.ndarray:
    audio = audio.astype(np.float32, copy=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1).astype(np.float32, copy=False)
    if not audio.flags.writeable:
        audio = audio.copy()
    peak = np.max(np.abs(audio)) if audio.size else 0.0
    if peak > 1e-6:
        # 原地归一化，避免为长音频额外创建一份完整数组。
        audio *= (0.95 / peak)
    return audio

def _hallucination_filter(raw: str) -> str:
    if not raw:
        return raw
    words = raw.split()
    if len(words) >= 6:
        top = max(set(words[:20]), key=words[:20].count)
        if words[:20].count(top) / min(len(words), 20) > 0.5:
            return ""
    compact = re.sub(r"\s+", "", raw)
    if len(compact) >= 8:
        for n in range(1, 6):
            unit = compact[:n]
            if not unit:
                continue
            repeated = unit * (len(compact) // n)
            if compact.startswith(repeated[:len(compact) - n + 1]):
                return ""
    return raw

def _resolve(repo_id: str) -> str:
    from pathlib import Path
    exts = (".safetensors", ".bin", ".npz")

    p = Path(repo_id).expanduser()
    if p.exists():
        return str(p)

    for base in [Path.home()/".cache"/"huggingface"/"hub",
                 Path.home()/".cache"/"modelscope"/"hub"]:
        d = base / ("models--" + repo_id.replace("/", "--"))
        if not d.is_dir():
            continue
        if any(f.suffix in exts for f in d.iterdir() if f.is_file()):
            return str(d)
        snaps = d / "snapshots"
        if snaps.is_dir():
            candidates = [x for x in snaps.iterdir()
                          if x.is_dir() and any(f.suffix in exts for f in x.iterdir() if f.is_file())]
            if candidates:
                candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
                return str(candidates[0])
    return repo_id

# ── 停顿间隙提取 ──────────────────────────────────────────────
def _extract_gaps(segments: list, min_gap_s: float = 0.3) -> list:
    """从 Whisper segments 提取停顿点（含词级时间戳信息）。"""
    gaps = []
    word_idx = 0
    for i, seg in enumerate(segments[:-1]):
        words_in_seg = seg.get("words", [])
        word_idx += len(words_in_seg)
        gap_s = segments[i+1].get("start", 0) - seg.get("end", 0)
        if gap_s >= min_gap_s:
            gaps.append({"idx": word_idx, "gap_s": round(gap_s, 2)})
    return gaps

# ── 字符→时间映射表 ──────────────────────────────────────────
def _build_char_time_map(segments: list, raw_text: str,
                          total_duration: float) -> list:
    """
    Whisper 词级时间戳 → raw_text 字符位置 → 音频时间 的分段线性映射表。
    返回 [(char_pos, audio_time), ...] 严格单调递增。
    """
    if not raw_text:
        return [(0, 0.0), (1, float(total_duration))]
    raw_len = len(raw_text)

    has_words = any(seg.get("words") for seg in (segments or []))
    if has_words:
        map_pts = []
        char_cursor = 0
        for seg in segments or []:
            seg_start = float(seg.get("start", 0.0) or 0.0)
            for w in seg.get("words") or []:
                wtxt_raw = str(w.get("word", "") or "")
                wtxt     = wtxt_raw.strip()
                if not wtxt:
                    continue
                ws = float(w.get("start", seg_start) or seg_start)
                we = float(w.get("end",   ws + 0.1)  or (ws + 0.1))
                idx = raw_text.find(wtxt_raw, char_cursor)
                if idx < 0:
                    idx = raw_text.find(wtxt, char_cursor)
                if idx < 0:
                    idx = char_cursor
                end_idx = (idx + len(wtxt_raw)
                           if raw_text.find(wtxt_raw, char_cursor) >= 0
                           else idx + len(wtxt))
                map_pts.append((idx, ws))
                map_pts.append((end_idx, we))
                char_cursor = end_idx
        if not map_pts:
            return [(0, 0.0), (raw_len, float(total_duration))]
        map_pts.sort(key=lambda x: x[0])
        if map_pts[0][0] > 0:
            # 字符位置 0 对应音频时间 0.0，而不是第一个 segment 的 start。
            # segments[0].start 是第一个词在音频中的位置，
            # 不能用它作为 char_pos=0 的时间锚——那会把所有 0..first_word_char
            # 的字符全部错误地映射到 segments[0].start，导致前段字幕时间集中跳变。
            map_pts.insert(0, (0, 0.0))
        if map_pts[-1][0] < raw_len:
            map_pts.append((raw_len, float(total_duration)))
        out = [map_pts[0]]
        for cp, t in map_pts[1:]:
            pc, pt = out[-1]
            if cp > pc:
                out.append((cp, max(t, pt)))
            elif t > pt:
                out[-1] = (pc, t)
        return out

    # 无可用词级时间戳时，退化为整段线性映射。
    if not segments:
        return [(0, 0.0), (raw_len, float(total_duration))]
    if len(segments) == 1:
        # 单段降级：char_pos=0 → 0.0s，char_pos=raw_len → segment end
        e0 = float(segments[0].get("end", total_duration) or total_duration)
        return [(0, 0.0), (raw_len, e0)]
    map_pts = []
    char_cursor = 0
    for seg in segments:
        st = str(seg.get("text","") or "").strip()
        ss = float(seg.get("start", 0.0) or 0.0)
        se = float(seg.get("end", total_duration) or total_duration)
        if not st:
            continue
        idx = raw_text.find(st, char_cursor)
        if idx < 0:
            idx = char_cursor
        map_pts.append((idx, ss))
        map_pts.append((idx + len(st), se))
        char_cursor = idx + len(st)
    if not map_pts:
        return [(0, 0.0), (raw_len, float(total_duration))]
    map_pts.sort(key=lambda x: x[0])
    if map_pts[0][0] > 0:
        map_pts.insert(0, (0, 0.0))
    if map_pts[-1][0] < raw_len:
        map_pts.append((raw_len, float(total_duration)))
    out = [map_pts[0]]
    for cp, t in map_pts[1:]:
        pc, pt = out[-1]
        if cp > pc:
            out.append((cp, max(t, pt)))
        elif t > pt:
            out[-1] = (pc, t)
    return out


def _lookup_char_time(map_pts: list, char_pos: int) -> float:
    if not map_pts:
        return 0.0
    char_pos = max(0, char_pos)
    if char_pos <= map_pts[0][0]:
        return float(map_pts[0][1])
    if char_pos >= map_pts[-1][0]:
        return float(map_pts[-1][1])
    lo, hi = 0, len(map_pts) - 1
    while lo + 1 < hi:
        mid = (lo + hi) // 2
        if map_pts[mid][0] <= char_pos:
            lo = mid
        else:
            hi = mid
    cp0, t0 = map_pts[lo]
    cp1, t1 = map_pts[hi]
    if cp1 == cp0:
        return float(t0)
    frac = (char_pos - cp0) / (cp1 - cp0)
    return float(t0 + frac * (t1 - t0))



# ── v0.7a 模型兼容层 ──────────────────────────────────────────
def _detect_model_profile(model_name: str = "", adv: dict = None) -> str:
    """Return thinking/legacy according to user setting and model name."""
    adv = adv or {}
    explicit = str(adv.get("llm_model_profile", "auto") or "auto").strip().lower()
    if explicit in {"thinking", "legacy"}:
        return explicit
    name = (model_name or "").lower()
    # Qwen3.6 thinking 系列：需要关闭显式思考输出，并使用 <think></think> 预填充。
    if "qwen3.6" in name or "thinking" in name:
        return "thinking"
    # Qwen3-30B / 14B 等旧模型：不使用 thinking prefill，分段和翻译更保守。
    if "qwen3-30b" in name or "qwen3-14b" in name or "qwen3-" in name:
        return "legacy"
    return "legacy"


def _profile_default(adv: dict, key: str, legacy_value, thinking_value=None):
    """Use profile-specific defaults only when the user has not changed the old built-in value."""
    profile = str(adv.get("_effective_model_profile", "legacy"))
    old_default = DEFAULT_ADVANCED_PARAMS.get(key)
    current = adv.get(key, old_default)
    if profile == "legacy" and current == old_default:
        return legacy_value
    if profile == "thinking" and thinking_value is not None and current == old_default:
        return thinking_value
    return current


def _assistant_prefill(model_profile: str = "legacy") -> str:
    """Assistant prefill. Only thinking models should receive an already-closed <think> block."""
    if model_profile == "thinking":
        return "<|im_start|>assistant\n<think>\n</think>\n"
    return "<|im_start|>assistant\n"


def _text_coverage_ok(src: str, out: str, min_ratio: float = 0.65) -> bool:
    """Rough guard against LLM dropping content. Conservative and language-agnostic."""
    src_clean = re.sub(r"\s+", "", src or "")
    out_clean = re.sub(r"\s+", "", out or "")
    if not src_clean:
        return True
    if len(out_clean) < max(3, len(src_clean) * min_ratio):
        return False
    return True

# ── LLM 输出解析（鲁棒） ─────────────────────────────────────
def _strip_thinking_blocks(text: str) -> str:
    """Remove Qwen-style thinking blocks, including an unfinished <think> tail."""
    return re.sub(r"<think>.*?(?:</think>|$)", "", text or "", flags=re.DOTALL).strip()



def _clean_llm_json_text(resp: str) -> str:
    """清理 LLM 输出中的 thinking、markdown fence 和常见尾巴。"""
    raw = _strip_thinking_blocks(resp)
    raw = re.sub(r"```(?:json)?\s*", "", raw, flags=re.IGNORECASE).strip()
    raw = raw.rstrip("`").strip()
    return raw


def _strip_json_trailing_commas(text: str) -> str:
    """删除 JSON 对象/数组闭合前的尾随逗号。"""
    return re.sub(r",\s*([}\]])", r"\1", text)


def _balanced_json_candidates(text: str) -> list:
    """
    从 LLM 输出中提取平衡的 JSON object/array 片段。
    支持字符串内转义，避免把字符串里的 } 或 ] 当成结构闭合。
    """
    candidates = []
    pairs = {"{": "}", "[": "]"}
    for i, ch in enumerate(text):
        if ch not in pairs:
            continue
        stack = [pairs[ch]]
        in_str = False
        esc = False
        for j in range(i + 1, len(text)):
            c = text[j]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c in pairs:
                stack.append(pairs[c])
            elif stack and c == stack[-1]:
                stack.pop()
                if not stack:
                    candidates.append(text[i:j + 1])
                    break
    return candidates


def _try_json_loads_many(texts: list):
    """依次尝试解析多个 JSON 文本。"""
    last_err = None
    for t in texts:
        if not t or not str(t).strip():
            continue
        x = _strip_json_trailing_commas(str(t).strip())
        try:
            return json.loads(x)
        except Exception as ex:
            last_err = ex
    if last_err:
        raise last_err
    raise ValueError("empty json candidates")


def _extract_json_value_string(raw: str, key: str) -> str:
    """从破损 JSON 中尽量提取某个字符串字段，支持转义字符。"""
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*"', raw)
    if not m:
        return ""
    i = m.end()
    out = []
    esc = False
    while i < len(raw):
        c = raw[i]
        if esc:
            out.append("\\" + c)
            esc = False
        elif c == "\\":
            esc = True
        elif c == '"':
            break
        else:
            out.append(c)
        i += 1
    txt = "".join(out)
    try:
        return json.loads('"' + txt + '"')
    except Exception:
        return txt.replace('\\"', '"').replace('\\n', '\n')


def _extract_translation_pairs(raw: str) -> dict:
    """从 translations 对象中提取已经完整闭合的译文字段；破损/截断字段会被跳过。"""
    pos = raw.find('"translations"')
    if pos < 0:
        return {}
    brace = raw.find("{", pos)
    if brace < 0:
        return {}
    # 截取 translations 后面一段即可；即使对象未闭合，也能抽取已闭合的 key-value 字符串。
    sub = raw[brace + 1:]
    pairs = {}
    for m in re.finditer(r'"([^"\\]*(?:\\.[^"\\]*)*)"\s*:\s*"((?:[^"\\]|\\.)*)"', sub):
        try:
            k = json.loads('"' + m.group(1) + '"')
            v = json.loads('"' + m.group(2) + '"')
        except Exception:
            k, v = m.group(1), m.group(2)
        if k and isinstance(v, str) and v.strip():
            pairs[k] = v.strip()
    return pairs


def _parse_llm_object(resp: str, fallback_text: str, label: str = "") -> dict:
    """
    解析 Phase 2 的单句 JSON 对象。
    目标是“尽可能完整”：优先保留 corrected；translations 破损时只丢弃破损字段，
    已完整输出的译文仍保留，而不是整句回退。
    """
    raw = _clean_llm_json_text(resp)
    candidates = [raw]
    candidates.extend(_balanced_json_candidates(raw))
    # 有些模型会在 JSON 前后添加文字，优先尝试第一段平衡对象。
    try:
        data = _try_json_loads_many(candidates)
        if isinstance(data, list) and data and isinstance(data[0], dict):
            data = data[0]
        if isinstance(data, dict):
            corrected = str(data.get("corrected", "")).strip() or fallback_text
            language = str(data.get("language", "") or "").strip()
            translations = data.get("translations", {}) or {}
            if not isinstance(translations, dict):
                translations = {}
            translations = {str(k): str(v).strip() for k, v in translations.items()
                            if str(k).strip() and str(v).strip()}
            print(f"[LLM {label}] JSON object OK translations={len(translations)}", flush=True)
            return {"corrected": corrected, "language": language, "translations": translations}
    except Exception as ex:
        print(f"[LLM {label}] JSON object fail: {ex} | raw[:120]={repr(raw[:120])}", flush=True)

    corrected = _extract_json_value_string(raw, "corrected").strip()
    language = _extract_json_value_string(raw, "language").strip()
    translations = _extract_translation_pairs(raw)
    if corrected:
        print(f"[LLM {label}] JSON repaired corrected + {len(translations)} translations", flush=True)
        return {"corrected": corrected, "language": language, "translations": translations}

    # 最后兜底：如果模型只输出纯文本且长度合理，保留纯文本；否则用 P1。
    plain = raw.strip().strip('"')
    if plain and len(plain) >= max(3, len(fallback_text) * 0.3) and len(plain) <= max(60, len(fallback_text) * 3):
        print(f"[LLM {label}] plain-text fallback", flush=True)
        return {"corrected": plain, "language": "", "translations": translations}

    print(f"[LLM {label}] fallback to P1 text", flush=True)
    return {"corrected": fallback_text, "language": "", "translations": translations}


def _parse_llm_json(resp: str, fallback_text: str, label: str = "") -> list:
    """
    解析 LLM JSON 输出。处理：
    - Qwen3 <think>...</think> thinking 块
    - markdown 代码块
    - JSON 前后夹杂自然语言
    - 截断/破损时尽量提取 corrected 和已完整闭合的 translations
    - 完全失败 → 按句终标点切句降级
    """
    raw = _clean_llm_json_text(resp)
    candidates = [raw]
    candidates.extend(_balanced_json_candidates(raw))

    # prompt pre-fill 场景：resp 可能不含开头 '['。
    if not raw.startswith("[") and raw.lstrip().startswith("{"):
        candidates.append("[" + raw + "]")
    if raw and not raw.rstrip().endswith("]"):
        last = raw.rfind("}")
        if last >= 0:
            candidates.append(raw[:last + 1])
            candidates.append("[" + raw[:last + 1] + "]")

    try:
        data = _try_json_loads_many(candidates)
        if isinstance(data, dict):
            data = [data]
        if isinstance(data, list):
            valid = [e for e in data
                     if isinstance(e, dict) and str(e.get("corrected", "")).strip()]
            if valid:
                print(f"[LLM {label}] JSON OK {len(valid)} entries", flush=True)
                return valid
    except Exception as ex:
        print(f"[LLM {label}] JSON fail: {ex} | raw[:120]={repr(raw[:120])}", flush=True)

    repaired = _parse_llm_object(raw, fallback_text, label=label + "-repair")
    if repaired.get("corrected") and repaired.get("corrected") != fallback_text:
        return [repaired]

    # 降级：按句终标点切句
    print(f"[LLM {label}] fallback sentence split", flush=True)
    parts = re.split(r"(?<=[。！？!?\n])", fallback_text)
    result = [{"corrected": s.strip(), "language": ""}
              for s in parts if len(s.strip()) >= 3]
    return result or [{"corrected": fallback_text, "language": ""}]


# ── Phase 1 Prompt：轻量纠错，不切句 ────────────────────────
def _prompt_phase1(chunk_text: str, context_prompt: str = "", context_limit: int = 300, model_profile: str = "legacy") -> str:
    """
    Phase 1：轻量纠错 + 标注句子边界。
    修正同音/近音字，在能确认的句子结束处加句终标点（。？！）。
    半句开头/结尾不加标点。不加逗号。不换行。输出连续纯文本。
    """
    domain = f"\n领域背景：{context_prompt[:context_limit]}" if context_prompt.strip() else ""
    no_think = "\n/no_think" if model_profile == "thinking" else ""
    return (
        "<|im_start|>system\n"
        "你是语音识别后处理助手。\n"
        "任务：修正同音/近音字错误，并在句子结束处标注句终标点。\n"
        "规则（严格遵守）：\n"
        "1. 修正明显的同音字或近音字识别错误（如'日缅'→'日冕'，'苏射计局'→'苏霍伊设计局'）。\n"
        "2. 在语义上能确定句子结束的地方加句号（。）、问号（？）或感叹号（！）。\n"
        "3. 不添加逗号、顿号等句内标点。\n"
        "4. 输入的开头或结尾若明显是半句话，该处不加句终标点。\n"
        "5. 不换行，保持输出为连续文本。\n"
        "6. 不翻译，不删减，不补充原文没有的内容。\n"
        "7. 直接输出纯文本，不输出任何解释。\n"
        f"{domain}"
        "<|im_end|>\n"
        "<|im_start|>user\n"
        f"{chunk_text}{no_think}"
        "<|im_end|>\n"
        + _assistant_prefill(model_profile)
    )


def _prompt_phase2(sentence_text: str, context_prompt: str = "",
                   translate_to: list = None, context_limit: int = 300, model_profile: str = "legacy") -> str:
    """
    Phase 2：对单个完整句子进行最终纠错、加标点，并同步翻译到目标语言。
    输入已经是完整句子（由 Phase 1 输出按句终标点切分得到）。
    输出：JSON 对象
      {
        "corrected": "修正后的句子。",
        "language":  "zh",
        "translations": {"English": "...", "Japanese": "..."}   ← 仅当 translate_to 非空
      }
    """
    domain = f"\n领域背景：{context_prompt[:context_limit]}" if context_prompt.strip() else ""
    no_think = "\n/no_think" if model_profile == "thinking" else ""

    if translate_to:
        lang_list = "、".join(translate_to)
        trans_rule = (
            f"3. 同时将原句翻译成以下语言：{lang_list}。\n"
            "4. 输出一个 JSON 对象，字段：corrected（纠错后原文）、language（原文语言代码）、"
            f"translations（对象，键为语言名，值为译文），例如：\n"
            '   {"corrected": "修正后句子。", "language": "zh", '
            '"translations": {"English": "Corrected sentence.", "Japanese": "修正された文。"}}\n'
            "5. 禁止输出任何解释、注释或 markdown 代码块。\n"
        )
    else:
        trans_rule = (
            "3. 仅输出一个 JSON 对象，含 corrected 和 language 两个字段。"
            '示例：{"corrected": "修正后的句子。", "language": "zh"}\n'
            "4. 禁止输出任何解释、注释或 markdown 代码块。\n"
        )

    return (
        "<|im_start|>system\n"
        "你是语音转录后处理助手。\n"
        "任务：对输入的单个句子做最终纠错并添加标点。\n"
        "规则：\n"
        "1. 修正同音/近音字错误，添加正确标点（句号、逗号、问号、感叹号等）。\n"
        "2. 不删减，不添加原文没有的内容。\n"
        f"{trans_rule}"
        f"{domain}"
        "<|im_end|>\n"
        "<|im_start|>user\n"
        f"句子：{sentence_text}{no_think}\n"
        "<|im_end|>\n"
        + _assistant_prefill(model_profile)
    )


# ── Phase 1 文本切 chunks（按停顿/字符数）────────────────────
def _split_into_chunks(raw_text: str, gaps: list,
                        max_chars: int = 350) -> list:
    """
    按 Whisper 停顿间隙和字符数上限切 chunk。
    返回 [{"text", "char_start", "char_end"}, ...]
    char_start/char_end 是在 raw_text 中的实际字符位置。
    """
    if not raw_text:
        return []
    if len(raw_text) <= max_chars:
        return [{"text": raw_text, "char_start": 0, "char_end": len(raw_text)}]

    total_words = len(raw_text.split()) or 1
    total_chars = len(raw_text)
    gap_char_positions = []
    for g in sorted(gaps, key=lambda x: x["idx"]):
        cp = int(g["idx"] / total_words * total_chars)
        gap_char_positions.append((cp, g["gap_s"]))

    chunks = []
    start = 0
    while start < len(raw_text):
        end = min(start + max_chars, len(raw_text))
        if end < len(raw_text):
            best_cut = end
            best_gap_s, best_gap_pos = 0.0, -1
            for cp, gs in gap_char_positions:
                if start + 30 < cp < end and gs > best_gap_s:
                    best_gap_s, best_gap_pos = gs, cp
            if best_gap_pos > 0:
                best_cut = best_gap_pos
            else:
                for i in range(end, max(start + 30, end - 60), -1):
                    if raw_text[i-1] in " \t，。！？、；":
                        best_cut = i
                        break
        else:
            best_cut = end
        raw_slice = raw_text[start:best_cut]
        chunk_text = raw_slice.strip()
        loff = len(raw_slice) - len(raw_slice.lstrip())
        roff = len(raw_slice) - len(raw_slice.rstrip())
        if chunk_text:
            chunks.append({
                "text":       chunk_text,
                "char_start": start + loff,
                "char_end":   best_cut - roff,
            })
        start = best_cut
    return chunks


# ── Phase 1 输出 → 按句终标点切句 ────────────────────────────
def _split_corrected_into_sentences(corrected_chunks: list,
                                     map_pts: list,
                                     total_duration: float,
                                     max_sentence_chars: int = 90,
                                     asr_segments: list = None,
                                     use_segment_text_fallback: bool = True) -> list:
    """
    将 Phase 1 纠错后的 chunks 拼接并切分为适合字幕显示的句子。

    优先按句终标点（。！？!?）切分。thinking profile 可在 Phase 1 没有补出句终标点时
    回退到 Whisper/SenseVoice 原始 segments 分组；legacy profile 默认禁用该文本回退，
    避免 ASR segment 边界残字直接传播到最终字幕。
    """
    full_text = ""
    chunk_offsets = []  # (start_in_full, end_in_full, original_char_start, original_char_end)
    for c in corrected_chunks:
        fs = len(full_text)
        full_text += c.get("p1_text", "")
        fe = len(full_text)
        chunk_offsets.append((fs, fe, c.get("char_start", 0), c.get("char_end", 0)))

    def full_pos_to_asr_time(pos: int) -> float:
        """将 full_text 中的字符位置转换为音频时间。"""
        pos = max(0, min(int(pos), len(full_text)))
        for (fs, fe, asr_s, asr_e) in chunk_offsets:
            if fs <= pos <= fe:
                frac = (pos - fs) / max(1, fe - fs)
                asr_char = asr_s + frac * (asr_e - asr_s)
                return _lookup_char_time(map_pts, int(asr_char))
        return float(total_duration or 0.0)

    def _append_piece(out: list, start_pos: int, end_pos: int):
        text = full_text[start_pos:end_pos].strip()
        if len(text) < 2:
            return
        ts = full_pos_to_asr_time(start_pos)
        te = full_pos_to_asr_time(end_pos)
        if te <= ts:
            te = min(float(total_duration or ts + 0.2), ts + 0.2)
        out.append({
            "p1_text":    text,
            "asr_raw":    text,
            "char_start": start_pos,
            "char_end":   end_pos,
            "start":      round(ts, 3),
            "end":        round(te, 3),
        })

    def _sentences_from_asr_segments(max_chars: int) -> list:
        """当 LLM 不补标点时，用原始 ASR segments 合并成字幕句。"""
        if not isinstance(asr_segments, list) or len(asr_segments) < 2:
            return []
        out = []
        buf = []
        start_t = None
        end_t = None
        cur_len = 0

        def flush():
            nonlocal buf, start_t, end_t, cur_len
            text = "".join(buf).strip()
            if len(text) >= 2 and start_t is not None and end_t is not None:
                out.append({
                    "p1_text":    text,
                    "asr_raw":    text,
                    "char_start": 0,
                    "char_end":   0,
                    "start":      round(float(start_t), 3),
                    "end":        round(float(end_t), 3),
                })
            buf = []
            start_t = None
            end_t = None
            cur_len = 0

        for seg in asr_segments:
            txt = str(seg.get("text", "")).strip()
            if not txt:
                continue
            s = seg.get("start", None)
            e = seg.get("end", None)
            try:
                s = float(s); e = float(e)
            except Exception:
                continue

            # 较长停顿视为自然边界。
            if buf and start_t is not None and s - float(end_t or s) >= 0.75:
                flush()

            if not buf:
                start_t = s
            buf.append(txt)
            end_t = e
            cur_len += len(txt)

            # 到达字幕长度上限，或 ASR segment 自带句末标点时切分。
            if cur_len >= max_chars or (txt and txt[-1] in "。！？!?；;：:"):
                flush()

        flush()
        return out

    # 第一层：按句终标点切分。
    primary_ends = [m.end() for m in re.finditer(r"[。！？!?]", full_text)]

    # 如果 Phase 1 基本没有补句终标点（例如只有全文末尾一个句号），
    # 则优先使用 ASR segments 分组。
    if use_segment_text_fallback and len(primary_ends) <= 1 and len(full_text) > max_sentence_chars * 2:
        seg_sents = _sentences_from_asr_segments(max_sentence_chars)
        if len(seg_sents) > 1:
            print(f"[P1→P2 fallback] weak/no sentence punctuation; grouped {len(seg_sents)} entries from ASR segments", flush=True)
            return seg_sents
    elif not use_segment_text_fallback and len(primary_ends) <= 1 and len(full_text) > max_sentence_chars * 2:
        print("[P1→P2 fallback] weak/no sentence punctuation; legacy profile keeps corrected text and uses safe forced split", flush=True)

    if not primary_ends or primary_ends[-1] < len(full_text):
        primary_ends.append(len(full_text))

    def _split_long_span(start_pos: int, end_pos: int, out: list):
        span_len = end_pos - start_pos
        if span_len <= max_sentence_chars:
            _append_piece(out, start_pos, end_pos)
            return

        cur = start_pos
        while cur < end_pos:
            hard_end = min(cur + max_sentence_chars, end_pos)
            cut = hard_end
            search_start = cur + max(20, max_sentence_chars // 2)
            for i in range(hard_end, search_start, -1):
                if full_text[i-1] in "，,、；;：:。！？!?\n":
                    cut = i
                    break
            if cut == hard_end and hard_end < end_pos:
                window = full_text[cur:hard_end]
                soft_markers = ["之后", "随后", "然后", "接下来", "此时", "但是", "所以", "因为", "如果", "当时", "的时候", "就", "呢", "啊"]
                best = -1
                for marker in soft_markers:
                    idx = window.rfind(marker)
                    if idx >= max(24, max_sentence_chars // 2):
                        best = max(best, idx + len(marker))
                if best > 0:
                    cut = cur + best
            if 0 < end_pos - cut < 16:
                cut = end_pos
            if cut <= cur:
                cut = hard_end
            _append_piece(out, cur, cut)
            cur = cut

    sentences = []
    prev = 0
    for end_pos in primary_ends:
        if end_pos <= prev:
            continue
        _split_long_span(prev, end_pos, sentences)
        prev = end_pos

    if len(sentences) <= 1 and len(full_text) > max_sentence_chars:
        print(f"[P1→P2 fallback] only {len(sentences)} sentence from {len(full_text)} chars; forced split enabled", flush=True)

    return sentences


# ── _smooth_entry_times ──────────────────────────────────────
def _smooth_entry_times(entries: list, total_duration: float,
                         min_len: float = 0.08) -> list:
    prev_end = 0.0
    for i, e in enumerate(entries):
        s  = float(e.get("start", 0.0) or 0.0)
        en = float(e.get("end", s + min_len) or (s + min_len))
        s  = max(0.0, min(s, float(total_duration or max(en, s))))
        if s < prev_end:
            s = prev_end
        if en <= s:
            next_s = None
            if i + 1 < len(entries):
                try:
                    next_s = float(entries[i+1].get("start", 0.0) or 0.0)
                except Exception:
                    next_s = None
            if next_s and next_s > s:
                en = min(next_s, s + max(min_len, (next_s - s) * 0.9))
            else:
                en = s + min_len
        if total_duration:
            en = min(float(total_duration), en)
        e["start"] = round(s, 3)
        e["end"]   = round(max(s + 0.01, en), 3)
        prev_end   = e["end"]
    return entries


# ══════════════════════════════════════════════════════════════
# ── 说话人识别（Speaker Diarization）────────────────────────
# ══════════════════════════════════════════════════════════════

# 全局缓存：存储上次的声纹嵌入，供 recluster（仅调整 threshold）时复用
_spk_embed_cache: dict = {}   # key: audio_path -> {"embeddings": [...], "entry_indices": [...]}


def _extract_mfcc_embedding(audio_chunk: np.ndarray, sr: int = 16000,
                             n_mfcc: int = 40, n_fft: int = 512,
                             hop: int = 160) -> np.ndarray:
    """
    纯 numpy 实现的 MFCC 声纹嵌入（无外部依赖降级方案）。
    返回 L2 归一化的均值 MFCC 向量（shape: [n_mfcc]）。
    """
    if audio_chunk is None or len(audio_chunk) < hop * 4:
        return np.zeros(n_mfcc, dtype=np.float32)

    audio_chunk = audio_chunk.astype(np.float32)

    # 预加重
    pre = np.append(audio_chunk[0], audio_chunk[1:] - 0.97 * audio_chunk[:-1])

    # 分帧
    n_frames = max(1, (len(pre) - n_fft) // hop + 1)
    frames = np.stack([pre[i*hop : i*hop + n_fft] for i in range(n_frames)])

    # 汉明窗
    window = np.hamming(n_fft).astype(np.float32)
    frames = frames * window

    # 功率谱
    mag = np.abs(np.fft.rfft(frames, n=n_fft)) ** 2  # [n_frames, n_fft//2+1]

    # Mel 滤波器组（向量化实现，避免 Python 双重 for 循环）
    n_mels = 40
    fmin, fmax = 0.0, sr / 2.0
    def hz2mel(f): return 2595.0 * np.log10(1.0 + f / 700.0)
    def mel2hz(m): return 700.0 * (10.0 ** (m / 2595.0) - 1.0)
    mel_min, mel_max = hz2mel(fmin), hz2mel(fmax)
    mel_pts = np.linspace(mel_min, mel_max, n_mels + 2)
    hz_pts  = mel2hz(mel_pts)
    bin_pts = np.floor((n_fft + 1) * hz_pts / sr).astype(int)

    # 向量化构建三角滤波器组：k_idx [1, n_fft//2+1]，对每个 mel 滤波器广播计算斜率
    k_idx = np.arange(n_fft // 2 + 1, dtype=np.float32)          # [K]
    f0 = bin_pts[:-2].reshape(-1, 1).astype(np.float32)           # [n_mels, 1] 左端
    f1 = bin_pts[1:-1].reshape(-1, 1).astype(np.float32)          # [n_mels, 1] 峰值
    f2 = bin_pts[2:  ].reshape(-1, 1).astype(np.float32)          # [n_mels, 1] 右端
    rise = np.where(f1 != f0, (k_idx - f0) / np.where(f1 != f0, f1 - f0, 1.0), 0.0)
    fall = np.where(f2 != f1, (f2 - k_idx) / np.where(f2 != f1, f2 - f1, 1.0), 0.0)
    fbank = np.clip(np.minimum(rise, fall), 0.0, 1.0).astype(np.float32)  # [n_mels, K]

    filter_banks = np.dot(mag, fbank.T)
    filter_banks = np.where(filter_banks == 0, np.finfo(float).eps, filter_banks)
    filter_banks = 20.0 * np.log10(filter_banks)

    # DCT -> MFCC
    n_frames_fb = filter_banks.shape[0]
    mfcc = np.zeros((n_frames_fb, n_mfcc), dtype=np.float32)
    for n in range(n_mfcc):
        mfcc[:, n] = np.sum(
            filter_banks * np.cos(np.pi * n / n_mels * (np.arange(n_mels) + 0.5)),
            axis=1
        )

    # 均值 + delta 特征（增强区分度）
    mean_mfcc = np.mean(mfcc, axis=0)
    # L2 归一化
    norm = np.linalg.norm(mean_mfcc)
    if norm > 1e-8:
        mean_mfcc /= norm
    return mean_mfcc.astype(np.float32)


def _get_embedding_fn():
    """
    返回 (embed_fn, dim) 元组。
    优先使用 resemblyzer（160-dim），降级到内置 MFCC（40-dim）。
    """
    try:
        from resemblyzer import VoiceEncoder, preprocess_wav
        encoder = VoiceEncoder()

        def embed_resemblyzer(chunk: np.ndarray, sr: int) -> np.ndarray:
            try:
                wav = preprocess_wav(chunk, source_sr=sr)
                if len(wav) < 1600:
                    return np.zeros(256, dtype=np.float32)
                emb = encoder.embed_utterance(wav)
                norm = np.linalg.norm(emb)
                return (emb / norm).astype(np.float32) if norm > 1e-8 else emb
            except Exception:
                return np.zeros(256, dtype=np.float32)

        print("[Diarize] using resemblyzer encoder (256-dim)", flush=True)
        return embed_resemblyzer, 256
    except ImportError:
        pass

    print("[Diarize] resemblyzer not found, using built-in MFCC (40-dim)", flush=True)

    def embed_mfcc(chunk: np.ndarray, sr: int) -> np.ndarray:
        return _extract_mfcc_embedding(chunk, sr=sr)

    return embed_mfcc, 40


def _agglomerative_cluster(embeddings: np.ndarray, threshold: float) -> list:
    """
    完全链接（complete linkage）层次聚类。
    threshold: 0~1 之间的余弦距离阈值（越小越严格，越多分组）。
    返回 cluster label 列表（0-based）。

    复杂度优化：预计算全量余弦距离矩阵，合并时用 np.maximum 增量更新簇间距离行，
    避免每轮重新遍历所有样本对，从 O(n³) 降至 O(n²)。
    """
    n = len(embeddings)
    if n == 0:
        return []
    if n == 1:
        return [0]

    # 余弦距离矩阵（1 - cosine_similarity），shape [n, n]
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms < 1e-8, 1.0, norms)
    normed = embeddings / norms
    sim  = np.dot(normed, normed.T)
    dist = np.clip(1.0 - sim, 0.0, 2.0).astype(np.float32)
    np.fill_diagonal(dist, 0.0)

    # 每个簇用一个"代表行"在距离矩阵中维护 complete-linkage 距离。
    # active[i] = True 表示簇 i 仍存活；cluster_dist[i, j] 是簇 i 与簇 j 的最大样本间距离。
    # 初始时每个样本是独立簇，cluster_dist 即原始距离矩阵。
    cluster_dist_mat = dist.copy()           # 当前簇间距离（complete linkage）
    active  = np.ones(n, dtype=bool)        # 存活标志
    members = [[i] for i in range(n)]       # 簇成员（用于最终 label 输出）

    # 对角线设为 inf，避免在 argmin 时选中自身
    np.fill_diagonal(cluster_dist_mat, np.inf)

    while True:
        active_ids = np.where(active)[0]
        if len(active_ids) <= 1:
            break

        # 在存活簇间找距离最小的一对（O(k²)，k 为当前存活簇数）
        sub = cluster_dist_mat[np.ix_(active_ids, active_ids)]
        flat_idx = np.argmin(sub)
        ri, rj = divmod(int(flat_idx), len(active_ids))
        best_d = float(sub[ri, rj])

        if best_d > threshold:
            break   # 所有剩余簇间距离均超过阈值，停止合并

        a, b = int(active_ids[ri]), int(active_ids[rj])
        if a > b:
            a, b = b, a   # 保证 a < b，始终合并到较小下标

        # Complete linkage 更新：新簇 a 与其余各簇的距离 = max(a 行, b 行)
        cluster_dist_mat[a, :] = np.maximum(cluster_dist_mat[a, :],
                                             cluster_dist_mat[b, :])
        cluster_dist_mat[:, a] = cluster_dist_mat[a, :]
        cluster_dist_mat[a, a] = np.inf   # 对角线保持 inf

        # 停用簇 b
        active[b] = False
        cluster_dist_mat[b, :] = np.inf
        cluster_dist_mat[:, b] = np.inf

        members[a].extend(members[b])
        members[b] = []

    # 重新编号，按各簇首个样本序号排序（保证 SPEAKER_1 最早出现）
    final_clusters = [(min(members[i]), i) for i in range(n) if active[i]]
    final_clusters.sort()
    label_map = {cid: label for label, (_, cid) in enumerate(final_clusters)}

    result = [0] * n
    for cid, (_, orig_cid) in enumerate(final_clusters):
        for idx in members[orig_cid]:
            result[idx] = cid
    return result


def run_diarization(audio_path: str, entries: list,
                    threshold: float, result_q: Queue,
                    task_id: int, cache_key: str) -> None:
    """
    说话人识别主函数。
    - 遍历全录音，为每个 entry 切出音频片段提取声纹嵌入
    - 全局聚类，label 写入 entry["speaker"]
    - 发送进度和结果到 result_q

    cache_key: 用于区分是否可以复用嵌入（仅调整 threshold 时复用）。
    """
    global _spk_embed_cache

    SR = 16000
    try:
        audio_full = np.fromfile(audio_path, dtype=np.float32)
    except Exception as e:
        result_q.put({"type": "diarize_done", "task_id": task_id,
                      "entries": entries, "error": str(e)})
        return

    n = len(entries)
    embed_fn, embed_dim = _get_embedding_fn()

    # ── 检查是否可以复用缓存的嵌入 ──────────────────────────
    cached = _spk_embed_cache.get(cache_key)
    if cached and len(cached["embeddings"]) == n:
        print("[Diarize] 复用声纹嵌入缓存，直接重新聚类", flush=True)
        embeddings = np.array(cached["embeddings"], dtype=np.float32)
    else:
        # ── 提取每个 entry 的声纹嵌入 ───────────────────────
        embeddings = np.zeros((n, embed_dim), dtype=np.float32)
        for i, entry in enumerate(entries):
            pct = 10 + int(i / n * 60)
            result_q.put({"type": "job_progress", "phase": "diarize",
                          "pct": pct, "msg": f"声纹提取 {i+1}/{n}…"})
            s = float(entry.get("start", 0.0) or 0.0)
            e = float(entry.get("end", s + 0.1) or (s + 0.1))
            s_idx = max(0, int(s * SR))
            e_idx = min(len(audio_full), int(e * SR))
            chunk = audio_full[s_idx:e_idx]
            if len(chunk) < SR * 0.15:   # < 150ms → 用相邻扩展
                pad = int(SR * 0.3)
                s_idx = max(0, s_idx - pad)
                e_idx = min(len(audio_full), e_idx + pad)
                chunk = audio_full[s_idx:e_idx]
            embeddings[i] = embed_fn(chunk, SR)

        # 缓存嵌入（仅保留最新一条，避免多次处理不同文件时无限累积内存）
        _spk_embed_cache.clear()
        _spk_embed_cache[cache_key] = {
            "embeddings": embeddings.tolist(),
        }
        print(f"[Diarize] 提取完成 {n} 个嵌入 (dim={embed_dim})", flush=True)

    # ── 聚类 ─────────────────────────────────────────────────
    result_q.put({"type": "job_progress", "phase": "diarize",
                  "pct": 75, "msg": "说话人聚类中…"})

    labels = _agglomerative_cluster(embeddings, threshold=threshold)
    n_speakers = len(set(labels))
    print(f"[Diarize] 聚类完成: {n_speakers} 位说话人 (threshold={threshold:.2f})", flush=True)

    # ── 写入 entry["speaker"] ────────────────────────────────
    for i, entry in enumerate(entries):
        entry["speaker"] = f"SPEAKER_{labels[i] + 1}"

    # ── 保存调试文件（JSON） ─────────────────────────────────────
    _save_stage("4_diarize", {
        "stage":        "speaker_diarization",
        "generated_at": datetime.now().isoformat(),
        "n_entries":    n,
        "n_speakers":   n_speakers,
        "threshold":    threshold,
        "embed_method": "resemblyzer" if embed_dim == 256 else "mfcc",
        "embed_dim":    embed_dim,
        "entries": [
            {
                "index":   i + 1,
                "start":   entry.get("start"),
                "end":     entry.get("end"),
                "speaker": entry.get("speaker",""),
                "text":    (entry.get("corrected","") or "")[:80],
            }
            for i, entry in enumerate(entries)
        ],
    })

    result_q.put({
        "type":       "diarize_done",
        "task_id":    task_id,
        "entries":    entries,
        "n_speakers": n_speakers,
        "threshold":  threshold,
    })




import re as _re
import sys as _sys
import threading as _threading
import io as _io

# ── 实时 ASR 科幻展示：捕获 verbose stdout，按 20 s 窗口推送前端 ──────────────
_TS_RE = _re.compile(
    r'^\[(\d+):(\d+)\.(\d+)\s*-->\s*(\d+):(\d+)\.(\d+)\]\s*(.*)', _re.DOTALL
)

def _parse_ts(m_min, m_sec, m_ms):
    """解析 [MM:SS.mmm] 为秒（float）"""
    return int(m_min) * 60 + int(m_sec) + int(m_ms) / 1000.0

class _AsrStdoutRelay:
    """
    上下文管理器：在 mlx_whisper.transcribe(verbose=True) 期间替换 sys.stdout，
    捕获每行 "[start --> end] text" 输出，按 20 s 音频窗口汇聚后
    实时发送到 result_q 供前端科幻面板展示。
    真实 ASR 结果（segments/words）完全不受影响。
    """
    BUCKET_S = 20.0
    MAX_CHARS = 1400

    def __init__(self, result_q, duration_s: float = 0.0):
        self._q        = result_q
        self._duration = duration_s
        self._orig     = None
        self._buf      = ''
        # 当前 20 s 桶
        self._cur_bucket  = -1
        self._cur_start   = 0.0
        self._cur_end     = 0.0
        self._cur_texts   = []
        self._batch_count = 0
        self._lock        = _threading.Lock()

    # ── StringIO 兼容接口，供 sys.stdout 替换 ──
    def write(self, s):
        if not s:
            return
        with self._lock:
            self._buf += s
            while '\n' in self._buf:
                line, self._buf = self._buf.split('\n', 1)
                self._handle_line(line)
        # 同时写到真实 stdout，保持 terminal 可见
        self._orig.write(s)

    def flush(self):
        self._orig.flush()

    def fileno(self):
        # 委托给真实 stdout，避免底层 C 扩展（如 mlx_whisper）调用时抛 UnsupportedOperation
        return self._orig.fileno()

    def isatty(self):
        return False

    def _handle_line(self, line: str):
        m = _TS_RE.match(line.strip())
        if not m:
            return
        start = _parse_ts(m.group(1), m.group(2), m.group(3))
        end   = _parse_ts(m.group(4), m.group(5), m.group(6))
        text  = m.group(7).strip()
        if not text:
            return
        bucket = int(start // self.BUCKET_S)
        new_bucket = (bucket != self._cur_bucket)
        if new_bucket:
            self._cur_bucket = bucket
            self._cur_start  = bucket * self.BUCKET_S
            self._cur_end    = end
            self._cur_texts  = []
        self._cur_end = max(self._cur_end, end)
        self._cur_texts.append(text)
        self._emit_current(new_bucket=new_bucket)

    def _emit_current(self, new_bucket: bool = False):
        """每个 segment 到来时推送一次。
        new_bucket=True  → 追加新行（新时间窗口的第一个词）
        new_bucket=False → 替换最后一行（同窗口内原地增长）
        """
        if self._cur_bucket < 0 or not self._cur_texts:
            return
        text = ' '.join(t for t in self._cur_texts if t)
        if len(text) > self.MAX_CHARS:
            text = '…' + text[-self.MAX_CHARS:]
        bucket_end = self._cur_start + self.BUCKET_S
        dur_str = f'/{int(self._duration)}s' if self._duration > 0 else ''
        pct = min(48, 12 + int(36 * self._cur_end / self._duration)) if self._duration > 0 else 0
        is_very_first = (self._batch_count == 0 and new_bucket)
        self._q.put({
            'type':                 'job_progress',
            'phase':                'asr',
            'pct':                  pct,
            'msg':                  f'ASR {int(self._cur_start)}–{int(bucket_end)}s{dur_str}',
            'preview_stage':        'asr',
            'preview_text':         f'[{int(self._cur_start):04d}–{int(bucket_end):04d}s] {text}',
            'preview_replace_last': not new_bucket,   # 同桶内：原地替换；新桶：追加新行
            'preview_clear':        is_very_first,    # 仅第一个桶的第一条清空面板
        })
        if new_bucket:
            self._batch_count += 1

    def __enter__(self):
        self._orig = _sys.stdout
        _sys.stdout = self
        return self

    def __exit__(self, *_):
        # 处理缓冲区剩余内容（最后一个桶由 _emit_current 在 _handle_line 里已实时发出）
        with self._lock:
            if self._buf:
                self._handle_line(self._buf)
                self._buf = ''
        _sys.stdout = self._orig


def _emit_asr_preview_batches(result_q, segments: list, bucket_s: float = 20.0, max_chars_per_batch: int = 1600):
    """
    将完整 ASR 结果按音频时间每 bucket_s 秒汇总成一批，仅用于前端科幻展示层。

    注意：这里不把音频切成 20 秒分别识别；ASR 仍然对完整音频一次识别，
    因此不会牺牲 Whisper 的上下文、时间戳和断句准确度。
    """
    if not segments:
        return
    buckets = []
    cur_idx = None
    cur_start = 0.0
    cur_end = 0.0
    cur_texts = []

    def flush():
        nonlocal cur_idx, cur_start, cur_end, cur_texts
        if cur_idx is None or not cur_texts:
            return
        text = " ".join(t.strip() for t in cur_texts if str(t).strip()).strip()
        if not text:
            return
        if len(text) > max_chars_per_batch:
            text = text[-max_chars_per_batch:]
        buckets.append((cur_start, cur_end, text))

    for seg in segments or []:
        try:
            st = float(seg.get("start", 0.0) or 0.0)
            en = float(seg.get("end", st) or st)
        except Exception:
            st, en = 0.0, 0.0
        idx = int(st // bucket_s)
        txt = str(seg.get("text", "") or "").strip()
        if cur_idx is None:
            cur_idx = idx
            cur_start = idx * bucket_s
            cur_end = en
        elif idx != cur_idx:
            flush()
            cur_idx = idx
            cur_start = idx * bucket_s
            cur_end = en
            cur_texts = []
        cur_end = max(cur_end, en)
        if txt:
            cur_texts.append(txt)
    flush()

    for i, (st, en, text) in enumerate(buckets):
        result_q.put({
            "type": "job_progress",
            "phase": "asr",
            "pct": min(48, 12 + int(36 * (i + 1) / max(1, len(buckets)))),
            "msg": f"ASR 预览 {int(st)}–{int(max(en, st + bucket_s))}s / {len(buckets)} batches",
            "preview_stage": "asr",
            "preview_text": f"[{int(st):04d}–{int(max(en, st + bucket_s)):04d}s] {text}\n",
            "preview_append": True,
            "preview_clear": (i == 0),
        })


# ── 子进程主函数 ──────────────────────────────────────────────
def worker_main(task_q: Queue, result_q: Queue,
                whisper_repo: str, llm_repo: str):
    from mlx_lm import load as mlx_load, generate as mlx_gen
    from mlx_lm.sample_utils import make_sampler

    # ── 模型加载 ──────────────────────────────────────────────
    import mlx_whisper
    w_ref = _resolve(whisper_repo)
    result_q.put({"type":"status","phase":"warmup","text":"预热 Whisper…","ready":False})
    mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32),
                           path_or_hf_repo=w_ref, word_timestamps=True)
    print("[worker] Whisper 就绪", flush=True)

    llm_ref = _resolve(llm_repo)
    result_q.put({"type":"status","phase":"warmup","text":"加载 LLM…","ready":False})
    print(f"[worker] 加载 LLM: {llm_repo}", flush=True)
    llm_model, llm_tok = mlx_load(llm_ref)
    print(f"[worker] LLM 就绪 | profile={_detect_model_profile(llm_repo, {})}", flush=True)

    result_q.put({"type":"status","phase":"ready","text":"就绪","ready":True})
    default_sampler = make_sampler(temp=0.0)

    # ── 主循环 ────────────────────────────────────────────────
    while True:
        task = task_q.get()
        if task is None:
            break
        kind = task.get("kind")

        # 每个任务都可以携带 debug_output 开关
        global _debug_output_enabled
        _debug_output_enabled = bool(task.get("debug_output", False))
        adv = _adv(task)
        model_profile = _detect_model_profile(llm_repo, adv)
        adv["_effective_model_profile"] = model_profile
        sampler = make_sampler(temp=_clamp_float(adv.get("llm_temperature"), 0.0, 1.5, 0.0))

        # ══ ASR ══════════════════════════════════════════════
        if kind == "asr":
            audio_path   = task.get("audio_path", "")
            if audio_path:
                audio = np.fromfile(audio_path, dtype=np.float32)
            else:
                audio = np.frombuffer(task["audio_bytes"], dtype=np.float32)
            asr_language = task.get("asr_language") or None
            tid          = task.get("task_id", 0)
            duration     = len(audio) / 16000

            t0 = time.perf_counter()
            try:
                audio = _prepare_audio(audio)

                import mlx_whisper
                with _AsrStdoutRelay(result_q, duration_s=duration) as _relay:
                    result = mlx_whisper.transcribe(
                        audio,
                        path_or_hf_repo=w_ref,
                        language=asr_language,
                        word_timestamps=True,
                        condition_on_previous_text=bool(adv.get("asr_condition_on_previous_text", False)),
                        no_speech_threshold=_clamp_float(adv.get("asr_no_speech_threshold"), 0.0, 1.0, 0.45),
                        compression_ratio_threshold=_clamp_float(adv.get("asr_compression_ratio_threshold"), 0.0, 10.0, 1.8),
                        logprob_threshold=_clamp_float(adv.get("asr_logprob_threshold"), -5.0, 1.0, -1.0),
                        fp16=bool(adv.get("asr_fp16", True)),
                        temperature=_clamp_float(adv.get("asr_temperature"), 0.0, 1.0, 0.0),
                        verbose=True,    # 让 mlx_whisper 逐 segment 打印，供 _AsrStdoutRelay 实时捕获
                    )
                raw_text      = _hallucination_filter(result.get("text","").strip())
                detected_lang = result.get("language","") or ""
                segments      = result.get("segments", [])
                emotion       = ""
                n_words = sum(len(s.get("words",[])) for s in segments)
                print(f"[Whisper] {len(segments)} segs, {n_words} words, "
                      f"raw_len={len(raw_text)}", flush=True)

                # 实时 ASR 展示已由 _AsrStdoutRelay 上下文管理器处理（verbose=True 逐 segment 捕获）
                # _emit_asr_preview_batches 保留备用，此处不再调用。

                gaps = _extract_gaps(segments)
                asr_ms = round((time.perf_counter() - t0) * 1000)

                # ── 保存 ASR 原始结果（JSON，含完整词级时间戳） ──────
                _save_stage("1_asr_raw", {
                    "stage":         "asr_raw",
                    "generated_at":  datetime.now().isoformat(),
                    "language":      detected_lang,
                    "duration_s":    round(duration, 3),
                    "asr_ms":        asr_ms,
                    "raw_text":      raw_text,
                    "n_segments":    len(segments),
                    "n_words":       n_words,
                    "segments": [
                        {
                            "id":    seg.get("id"),
                            "start": seg.get("start"),
                            "end":   seg.get("end"),
                            "text":  seg.get("text","").strip(),
                            "words": seg.get("words", []),
                        }
                        for seg in segments
                    ],
                    "gaps": gaps,
                })

                result_q.put({
                    "type": "asr_done", "task_id": tid,
                    "raw": raw_text, "lang": detected_lang,
                    "segments": segments, "gaps": gaps,
                    "emotion": emotion, "asr_ms": asr_ms, "duration": duration,
                })

            except Exception as e:
                import traceback
                result_q.put({"type":"error","task_id":tid,
                              "msg":f"ASR: {e}\n{traceback.format_exc()}"})

        # ══ LLM 两阶段纠错 ═══════════════════════════════════
        elif kind == "llm_correct":
            raw_text   = task.get("raw", "")
            gaps       = task.get("gaps", [])
            ctx_prompt = task.get("context_prompt", "")
            tid        = task.get("task_id", 0)
            segments   = task.get("segments", [])
            duration   = task.get("duration", 0.0)
            translate_to = task.get("translate_to", [])   # 目标语言英文名列表

            if not raw_text.strip():
                result_q.put({"type":"llm_done","task_id":tid,"entries":[],"llm_ms":0})
                continue

            t0 = time.perf_counter()
            try:
                # 建立字符→时间映射表（基于 Whisper 词级时间戳）
                map_pts = _build_char_time_map(segments, raw_text, duration)

                # ─── Phase 1：轻量纠错，不切句 ─────────────────
                context_limit = _clamp_int(adv.get("llm_context_prompt_max_chars"), 0, 2000, 300)
                p1_chunk_max = _clamp_int(_profile_default(adv, "llm_phase1_chunk_max_chars", 280, 350), 80, 2000, 350)
                p1_max_tokens = _clamp_int(_profile_default(adv, "llm_phase1_max_tokens", 900, 1200), 128, 8192, 1200)
                p1_min_ratio = _clamp_float(_profile_default(adv, "llm_phase1_min_length_ratio", 0.68, 0.5), 0.1, 1.0, 0.5)
                p2_base_tokens = _clamp_int(_profile_default(adv, "llm_phase2_base_max_tokens", 900, 1200), 128, 8192, 1200)
                p2_lang_tokens = _clamp_int(_profile_default(adv, "llm_phase2_tokens_per_target_lang", 0, 600), 0, 4096, 600)
                inline_translate_to = [] if model_profile == "legacy" else (translate_to or [])
                print(f"[LLM] profile={model_profile} p1_chunk={p1_chunk_max} inline_translate={bool(inline_translate_to)}", flush=True)
                chunks = _split_into_chunks(raw_text, gaps, max_chars=p1_chunk_max)
                n_chunks = len(chunks)
                print(f"[P1] {n_chunks} chunks", flush=True)

                corrected_chunks = []
                for ci, chunk in enumerate(chunks):
                    pct = 50 + int(ci / n_chunks * 25)
                    result_q.put({"type":"job_progress","phase":"llm",
                                  "pct": pct,
                                  "msg": f"Phase 1 纠错 {ci+1}/{n_chunks}…"})
                    prompt = _prompt_phase1(chunk["text"], ctx_prompt, context_limit, model_profile)
                    resp   = mlx_gen(llm_model, llm_tok, prompt=prompt,
                                     max_tokens=p1_max_tokens, sampler=sampler, verbose=False)
                    # Phase 1 输出纯文本，去掉 thinking 块
                    p1_text = _strip_thinking_blocks(resp)
                    # 若 LLM 擅自加了大量标点或大改，退回原文
                    if (not p1_text or
                        len(p1_text) < len(chunk["text"]) * p1_min_ratio or
                        not _text_coverage_ok(chunk["text"], p1_text, min_ratio=p1_min_ratio)):
                        print(f"[P1 coverage] chunk {ci+1} fallback to raw chunk", flush=True)
                        p1_text = chunk["text"]
                    print(f"[P1] chunk {ci+1}: {len(chunk['text'])}→{len(p1_text)} chars",
                          flush=True)
                    corrected_chunks.append({
                        "p1_text":   p1_text,
                        "char_start": chunk["char_start"],
                        "char_end":   chunk["char_end"],
                    })
                    # Visual-only stream for the front-end processing panel.
                    result_q.put({"type":"job_progress","phase":"llm",
                                  "pct": pct,
                                  "msg": f"Phase 1 纠错 {ci+1}/{n_chunks}…",
                                  "preview_stage": "p1",
                                  "preview_text": p1_text,
                                  "preview_append": True,
                                  "preview_clear": ci == 0})

                # ─── 按句终标点重新切句 ─────────────────────────
                result_q.put({"type":"job_progress","phase":"llm",
                               "pct":76,"msg":"按句重新分段…"})
                sentences = _split_corrected_into_sentences(
                    corrected_chunks, map_pts, duration,
                    max_sentence_chars=max(55, min(120, p1_chunk_max // 4)),
                    asr_segments=segments,
                    use_segment_text_fallback=(model_profile == "thinking"))
                print(f"[P1→P2] {len(sentences)} sentences", flush=True)

                # ── 保存 Phase 1 结果（JSON） ─────────────────
                _save_stage("2_phase1", {
                    "stage":        "phase1_llm_correct",
                    "generated_at": datetime.now().isoformat(),
                    "n_chunks":     len(corrected_chunks),
                    "n_sentences":  len(sentences),
                    "chunks": [
                        {
                            "index":      ci + 1,
                            "char_start": c["char_start"],
                            "char_end":   c["char_end"],
                            "p1_text":    c["p1_text"],
                        }
                        for ci, c in enumerate(corrected_chunks)
                    ],
                    "sentences": [
                        {
                            "index":   si + 1,
                            "start":   s["start"],
                            "end":     s["end"],
                            "p1_text": s["p1_text"],
                        }
                        for si, s in enumerate(sentences)
                    ],
                })

                # ─── Phase 2：单句精细纠错 + 加标点 ────────────
                n_sents = len(sentences)
                entries = []

                def _detect_repetition(text: str, window: int = 8, thresh: int = 4) -> bool:
                    """检测 LLM 输出是否陷入重复循环（连续相同 n-gram 超过阈值）。"""
                    if not text:
                        return False
                    words = list(text)  # 字符级
                    if len(words) < window * thresh:
                        return False
                    # 取末尾 window 个字符作为检测片段
                    tail = text[-(window * thresh):]
                    chunk = text[-window:]
                    count = tail.count(chunk)
                    return count >= thresh

                for si, sent in enumerate(sentences):
                    pct = 76 + int(si / max(n_sents, 1) * 20)
                    p2_progress = {"type":"job_progress","phase":"llm",
                                   "pct": pct,
                                   "msg": f"Phase 2 精细纠错 {si+1}/{n_sents}…",
                                   "preview_stage": "p2"}
                    if si == 0:
                        p2_progress.update({
                            "preview_clear": True,
                            "preview_text": "Phase II semantic refinement...\nPreparing sentence-level correction and translations...",
                            "preview_append": False,
                        })
                    result_q.put(p2_progress)
                    p1_text = sent["p1_text"]

                    # ── 输入长度守卫：超长句直接跳过 LLM，用 P1 原文 ──
                    # 阈值动态跟随 P1 chunk 上限，确保不会把合法的长句误判为异常。
                    p2_skip_threshold = p1_chunk_max + 50
                    if len(p1_text) > p2_skip_threshold:
                        print(f"  [P2 skip] sent {si+1} too long ({len(p1_text)} chars > {p2_skip_threshold}), using p1_text", flush=True)
                        corrected    = p1_text
                        language     = ""
                        translations = {}
                    else:
                        # 翻译语言列表：过滤掉与原文相同的语言（运行时按 language 字段再次过滤）
                        prompt = _prompt_phase2(p1_text, ctx_prompt, inline_translate_to, context_limit, model_profile)
                        # 含翻译时输出更长，适当增加 max_tokens
                        p2_max_tokens = p2_base_tokens + p2_lang_tokens * len(inline_translate_to)
                        resp   = mlx_gen(llm_model, llm_tok, prompt=prompt,
                                         max_tokens=p2_max_tokens, sampler=sampler, verbose=False)
                        # 去掉 thinking 块
                        resp_stripped = _strip_thinking_blocks(resp)

                        # ── 重复幻觉检测：直接回退到 P1 原文 ──────────
                        if _detect_repetition(resp_stripped, window=6, thresh=5):
                            print(f"  [P2 hallucination] sent {si+1} repetition detected, fallback to p1_text", flush=True)
                            corrected    = p1_text
                            language     = ""
                            translations = {}
                        else:
                            # resp_stripped 是 LLM 的完整输出。
                            # 期望格式：{"corrected": "...", "language": "zh", "translations": {...}}
                            # 这里使用鲁棒解析器：即使 translations 中某个语言字段被截断，
                            # 也尽量保留 corrected、language 以及已经完整闭合的译文。
                            parsed_obj = _parse_llm_object(resp_stripped, p1_text, label=f"P2-sent{si+1}")
                            corrected    = parsed_obj.get("corrected", "").strip() or p1_text
                            language     = parsed_obj.get("language", "") or ""
                            translations = parsed_obj.get("translations", {}) or {}
                            if not isinstance(translations, dict):
                                translations = {}
                            if not _text_coverage_ok(p1_text, corrected, min_ratio=0.55):
                                print(f"  [P2 coverage] sent {si+1} corrected too short, fallback", flush=True)
                                corrected = p1_text
                                translations = {}

                            # 二次检测：解析后内容异常长或重复
                            if len(corrected) > len(p1_text) * 3 or _detect_repetition(corrected, window=6, thresh=4):
                                print(f"  [P2 hallucination] sent {si+1} corrected suspicious, fallback", flush=True)
                                corrected    = p1_text
                                language     = ""
                                translations = {}

                            # 过滤掉与原文语言相同的翻译条目（LLM 有时会重复输出原文）
                            if translations and language:
                                translations = {k: v for k, v in translations.items()
                                                if k.lower() != language.lower()}

                    entry_obj = {
                        "corrected":    corrected,
                        "language":     language,
                        "start":        sent["start"],
                        "end":          sent["end"],
                        "asr_ts_start": sent["start"],
                        "asr_ts_end":   sent["end"],
                        "asr_raw":      sent["asr_raw"],
                        "emotion":      "",
                        "translations": translations if inline_translate_to else {},
                    }
                    entries.append(entry_obj)
                    # Visual-only Phase 2 stream. Includes corrected text and completed translations.
                    pv_lines = [corrected]
                    for _tl, _tv in (entry_obj.get("translations") or {}).items():
                        if _tv:
                            pv_lines.append(f"{_tl}: {_tv}")
                    result_q.put({"type":"job_progress","phase":"llm",
                                  "pct": pct,
                                  "msg": f"Phase 2 精细纠错 {si+1}/{n_sents}…",
                                  "preview_stage": "p2",
                                  "preview_text": "\n".join(pv_lines),
                                  "preview_append": True,
                                  "preview_clear": si == 0})

                entries = _smooth_entry_times(entries, duration)
                llm_ms  = round((time.perf_counter() - t0) * 1000)
                print(f"[LLM] done: {len(entries)} entries, {llm_ms}ms", flush=True)

                # ── 保存 Phase 2 最终字幕（JSON，含 ASR 原文对比） ──
                _save_stage("3_phase2_final", {
                    "stage":        "phase2_llm_corrected",
                    "generated_at": datetime.now().isoformat(),
                    "n_entries":    len(entries),
                    "llm_ms":       llm_ms,
                    "entries": [
                        {
                            "index":      i + 1,
                            "start":      e.get("start"),
                            "end":        e.get("end"),
                            "language":   e.get("language",""),
                            "corrected":  e.get("corrected",""),
                            "asr_raw":    e.get("asr_raw",""),
                            "changed":    e.get("corrected","") != e.get("asr_raw",""),
                        }
                        for i, e in enumerate(entries)
                    ],
                })

                # ── 终端打印摘要 ────────────────────────────────
                print("=" * 72, flush=True)
                print(f"[LLM OUTPUT] 共 {len(entries)} 条字幕", flush=True)
                print("=" * 72, flush=True)
                for i, e in enumerate(entries):
                    s   = e.get("start", 0.0); end = e.get("end", 0.0)
                    print(f"  [{i+1:03d}] {s:7.3f}s -> {end:7.3f}s  [{e.get('language','')}]  {e.get('corrected','')}", flush=True)
                print("=" * 72, flush=True)

                result_q.put({
                    "type": "llm_done", "task_id": tid,
                    "entries": entries, "llm_ms": llm_ms,
                })

            except Exception as e:
                import traceback
                tb = traceback.format_exc()
                print(f"[LLM ERROR] {e}\n{tb}", flush=True)
                result_q.put({
                    "type": "llm_done", "task_id": tid,
                    "entries": [{"corrected": raw_text, "language": "",
                                 "start": 0.0, "end": duration,
                                 "asr_raw": raw_text, "asr_ts_start": 0.0,
                                 "asr_ts_end": duration,
                                 "emotion": ""}],
                    "llm_ms": round((time.perf_counter() - t0) * 1000),
                    "error":  str(e),
                })

        # ══ 说话人识别 ════════════════════════════════════════
        elif kind == "diarize":
            tid         = task.get("task_id", 0)
            audio_path  = task.get("audio_path", "")
            entries     = task.get("entries", [])
            threshold   = float(task.get("threshold", 0.35))
            cache_key   = task.get("cache_key", audio_path)
            try:
                run_diarization(audio_path, entries, threshold,
                                result_q, tid, cache_key)
            except Exception as e:
                import traceback
                result_q.put({"type": "diarize_done", "task_id": tid,
                              "entries": entries,
                              "error": f"{e}\n{traceback.format_exc()}"})

        # ══ 单句翻译 ══════════════════════════════════════════
        elif kind == "translate_entry":
            text         = task.get("text", "")
            translate_to = task.get("translate_to", [])
            entry_id     = task.get("entry_id", 0)
            tid          = task.get("task_id", 0)
            src_lang     = task.get("src_lang", "")
            if not text or not translate_to:
                result_q.put({"type":"translate_done","task_id":tid,
                              "entry_id":entry_id,"translations":{}})
                continue
            t0 = time.perf_counter()
            try:
                trans_lines = "".join(f'    "{l}": "<translation>",\n' for l in translate_to)
                trans_lines = trans_lines.rstrip(",\n") + "\n"
                trans_block = f',\n  "translations": {{\n{trans_lines}  }}'
                no_think = "\n/no_think" if model_profile == "thinking" else ""
                prompt = (
                    "<|im_start|>system\nYou are a multilingual translator.\n"
                    "Rules:\n1. Translate into every target language.\n"
                    "2. Return ONLY valid JSON. No explanation.\n<|im_end|>\n"
                    "<|im_start|>user\n"
                    f'Text ({src_lang}): "{text}"\n\n'
                    "{\n"
                    f'  "language": "{src_lang}"{trans_block}\n'
                    f"}}{no_think}\n<|im_end|>\n"
                    + _assistant_prefill(model_profile)
                )
                tr_base = _clamp_int(adv.get("llm_translate_base_tokens"), 128, 8192, 800)
                tr_per_lang = _clamp_int(adv.get("llm_translate_tokens_per_target_lang"), 0, 4096, 350)
                tr_cap = _clamp_int(adv.get("llm_translate_max_tokens_cap"), 256, 16384, 2400)
                max_toks = min(tr_cap, tr_base + tr_per_lang * max(1, len(translate_to)))
                resp = mlx_gen(llm_model, llm_tok, prompt=prompt,
                               max_tokens=max_toks, sampler=sampler, verbose=False)
                # 与 Phase II 使用同一套鲁棒解析：即使某个语言字段破损，也尽量保留已完整输出的译文；
                # 即使完全解析失败，也必须返回 translate_done，让前端进度继续前进。
                try:
                    out = _parse_llm_object(resp, fallback_text=text, label=f"TRANSLATE-{entry_id}")
                    translations = out.get("translations", {}) or {}
                except Exception as parse_ex:
                    print(f"[Translate {entry_id}] parse fail: {parse_ex}", flush=True)
                    translations = {}
                result_q.put({
                    "type":"translate_done","task_id":tid,"entry_id":entry_id,
                    "translations":translations,
                    "llm_ms":round((time.perf_counter()-t0)*1000),
                })
            except Exception as e:
                # 注意：即使翻译失败，也返回 translate_done，避免全文重新翻译进度卡死。
                result_q.put({"type":"translate_done","task_id":tid,
                              "entry_id":entry_id,"translations":{},"error":str(e)})
