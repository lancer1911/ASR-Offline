


// ── Constants ─────────────────────────────────────────────────
const LANGS = ["中文","英文","日文","韩文","法文","德文","西班牙文"];
// ASR Live 复用的深/浅色主题 SVG 图标
const ICON_MOON = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" fill="white"/></svg>`;
const ICON_SUN  = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5" fill="white"/><line x1="12" y1="1" x2="12" y2="3" stroke-width="2.8"/><line x1="12" y1="21" x2="12" y2="23" stroke-width="2.8"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke-width="2.8"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke-width="2.8"/><line x1="1" y1="12" x2="3" y2="12" stroke-width="2.8"/><line x1="21" y1="12" x2="23" y2="12" stroke-width="2.8"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke-width="2.8"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke-width="2.8"/></svg>`;
const ICON_VOL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const ICON_MUTED = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>`;

// ── i18n helpers ──────────────────────────────────────────────
function tr(key, vars) {
  return (window.I18N && window.I18N.t) ? window.I18N.t(key, vars) : key;
}
function trMsg(msg) {
  return (window.I18N && window.I18N.translateBackendMsg) ? window.I18N.translateBackendMsg(msg) : (msg || '');
}
function trReplace(key, map) {
  let s = tr(key);
  for (const k in map) s = s.replaceAll(k, map[k]);
  return s;
}
const LANG_KEY = {
  '中文':'lang.zh','英文':'lang.en','日文':'lang.ja','韩文':'lang.ko',
  '法文':'lang.fr','德文':'lang.de','西班牙文':'lang.es',
  'Chinese':'lang.zh','English':'lang.en','Japanese':'lang.ja','Korean':'lang.ko',
  'French':'lang.fr','German':'lang.de','Spanish':'lang.es',
  'zh':'lang.zh','en':'lang.en','ja':'lang.ja','ko':'lang.ko','fr':'lang.fr','de':'lang.de','es':'lang.es',
  'chinese':'lang.zh','english':'lang.en','japanese':'lang.ja','korean':'lang.ko',
  'french':'lang.fr','german':'lang.de','spanish':'lang.es',
};
function langDisplayName(l) {
  const key = LANG_KEY[l] || LANG_KEY[String(l || '').toLowerCase()];
  return key ? tr(key) : (l || '');
}
function langCanonical(l) {
  const key = LANG_KEY[l] || LANG_KEY[String(l || '').toLowerCase()] || '';
  const m = key.match(/^lang\.(zh|en|ja|ko|fr|de|es)$/);
  return m ? m[1] : 'other';
}
function langColorVars(l) {
  const c = langCanonical(l);
  return `--lang-fg:var(--lang-${c});--lang-bg:var(--lang-${c}-bg);--lang-bd:var(--lang-${c}-bd)`;
}
function langTag(l) {
  return `<span class="trans-lang-tag" style="${langColorVars(l)}">${esc(langDisplayName(l))}</span>`;
}
function setBtnText(id, key) {
  const el = document.getElementById(id);
  if (el) el.textContent = tr(key);
}
function applyRuntimeI18n() {
  if (window.I18N) window.I18N.applyI18n();
  const tst = document.getElementById('TST');
  if (tst && _ready && !tst.dataset.translating) tst.textContent = tr('topbar.ready');
  buildLangGrid();
  if (_entries && _entries.length) {
    renderEntries(_entries);
    updateSpeakerPanel(_entries);
  }
  renderSingleLangList();
  syncDebugOutputUI(_settings || {});
  if (document.getElementById('ADV_MASK')?.classList.contains('visible')) renderAdvancedSettings();
  updateSciModeButton();
}

document.addEventListener('i18n:changed', applyRuntimeI18n);
document.addEventListener('DOMContentLoaded', () => {
  if (window.I18N) window.I18N.applyI18n();
});

// ── State ─────────────────────────────────────────────────────
let ws, _ready = false, _settings = {}, _defaultSettings = {}, _entries = [],
    _currentPhase = 0, _segments = [], _rawText = '',
    _jobPollTimer = null,
    _speakerColorMap = null,
    _speakerOrder = [],
    _spkPopupTarget = null,
    _debugOutputEnabled = false,   // 调试文件输出开关
    _selectedExportLang = null,    // 单语言导出当前选中语言
    _sciStage = '', _sciText = '', _sciFadeTimer = null, // 处理过程科幻展示层
    _sciAsrSimTimer = null, _sciAsrSimSec = 0,
    _sciAsrQueue = [], _sciAsrQueueTimer = null,
    _sciMode = localStorage.getItem('asr_offline_sci_mode') || 'aurora',
    _sciSparkSalt = Math.floor(Math.random() * 10000);

// ── WS ────────────────────────────────────────────────────────
function connect() {
  ws = new WebSocket("ws://127.0.0.1:17434/ws");
  ws.onmessage = e => handle(JSON.parse(e.data));
  ws.onclose   = () => setTimeout(connect, 1500);
}

function handle(m) {
  switch(m.type) {

    case 'init':
      _settings    = m.settings || {};
      _entries     = m.entries  || [];
      if (m.worker_ready) {
        _ready = true;
        document.getElementById('DOT').classList.add('on');
        document.getElementById('TST').textContent = tr('topbar.ready');
      }
      if (m.segments) _segments = m.segments;
      if (m.raw_text !== undefined) _rawText = m.raw_text || '';
      applySettings(_settings);
      loadDefaultSettings();
      loadModels();
      if (m.job_status === 'review') {
        showReview(Array.isArray(_entries) ? _entries : []);
      } else if (m.job_status === 'asr' || m.job_status === 'llm' || m.job_status === 'diarize') {
        // WebSocket reconnected while job is still running
        if (m.file_info && m.file_info.filename) showFileCard(m.file_info);
        setPhase(m.job_status === 'asr' ? 1 : m.job_status === 'llm' ? 2 : 3);
        document.getElementById('PROG').classList.add('visible');
        startJobPolling();
      } else if (m.file_info && m.file_info.filename) {
        showFileCard(m.file_info);
      }
      break;

    case 'status':
      document.getElementById('TST').textContent = trMsg(m.text);
      if (m.ready) {
        document.getElementById('DOT').classList.add('on');
        _ready = true;
        // Show warmup phase label
        if (m.phase === 'ready') setPhase(0);
        // If a file was selected while the worker was still warming up,
        // enable Start as soon as the worker becomes ready.
        const startBtn = document.getElementById('BTN_START');
        const fileCard = document.getElementById('FILE_CARD');
        if (startBtn && fileCard && fileCard.classList.contains('visible')) {
          startBtn.disabled = false;
        }
      } else {
        document.getElementById('DOT').classList.remove('on');
        _ready = false;
        // Show warmup progress
        document.getElementById('TST').textContent =
          (m.phase === 'warmup' ? tr('msg.warmup_prefix') : '') + trMsg(m.text);
      }
      break;

    case 'file_ready':
      showFileCard(m.info);
      break;

    case 'phase_update':
      updateProgress(m.pct || 0, m.msg || '');
      if (m.phase === 'asr') {
        setPhase(1);
        sciSetStage('asr');
        // 若后端已发来真实 preview_text，停止假文字模拟；否则保持模拟作为占位
        if (m.preview_text) {
          sciStopAsrSim();
        } else if (!_sciAsrSimTimer) {
          sciStartAsrSim();
        }
      }
      if (m.phase === 'llm') {
        setPhase(2);
        sciStopAsrSim();
        // If the backend sends a pure progress message without preview_stage,
        // infer the visual stage from the message text.  Otherwise Phase II
        // progress messages briefly switched the header back to Phase I.
        const inferredStage = m.preview_stage || (/Phase\s*2|阶段\s*2|第二阶段|P2/i.test(String(m.msg || '')) ? 'p2' : (_sciStage === 'p2' ? 'p2' : 'p1'));
        sciSetStage(inferredStage, !!m.preview_clear);
      }
      if (m.phase === 'diarize') {
        setPhase(3);
        sciStopAsrSim();
        sciSetStage('diarize');
      }
      if (m.raw !== undefined && m.raw !== null) sciSetText(m.raw || '', 'asr');
      if (m.preview_text !== undefined && m.preview_text !== null) {
        const pvStage = m.preview_stage || m.phase;
        if (pvStage === 'asr') {
          // 实时流：停止假文字模拟
          sciStopAsrSim();
          if (m.preview_clear) {
            sciSetText(m.preview_text || '', 'asr');
          } else if (m.preview_replace_last) {
            // 同一时间窗口内：原地替换最后一行，呈现词语逐渐增长的效果
            sciReplaceLast(m.preview_text || '', 'asr');
          } else {
            // 新时间窗口：追加新行
            sciAppend(m.preview_text || '', 'asr');
          }
        } else {
          if (m.preview_clear) sciSetText('', pvStage);
          if (m.preview_append === false) sciSetText(m.preview_text || '', pvStage);
          else sciAppend(m.preview_text || '', pvStage);
        }
      }
      // Backward-compatible path: older backend may still send entries here.
      if (m.phase === 'review' && m.entries !== undefined) {
        handleLlmDone(m);
      }
      break;

    case 'llm_done':
      handleLlmDone(m);
      break;

    case 'diarize_done':
      handleDiarizeDone(m);
      break;

    case 'speaker_renamed':
      // Server already updated G.job_entries; apply locally
      applyRenameLocally(m.old, m.new);
      break;

    case 'session_loaded':
      sciHideNow();
      _entries = Array.isArray(m.entries) ? m.entries : [];
      _segments = Array.isArray(m.segments) ? m.segments : [];
      _rawText = m.raw_text || '';
      if (m.settings) applySettings(m.settings);
      setPhase(4);
      updateProgress(100, m.has_audio ? trReplace('msg.session_loaded_audio', {N: _entries.length}) : trReplace('msg.session_loaded', {N: _entries.length}));
      if (m.auto_audio_error) console.warn('ASO 音频自动配对失败:', m.auto_audio_error);
      // 若 ASO 记录了原始音频元信息，显示文件卡片（灰色/待配对状态）
      if (m.source_audio && m.source_audio.filename) {
        showFileCard(m.source_audio);
        _pendingAudioFilename = m.source_audio.filename;
      }
      // Bug 1 fix: 重置音频加载标志，确保 showReview 会尝试加载服务端音频
      _audioLoaded = false;
      if (_audioEl) { _audioEl.pause(); _audioEl.src = ''; }
      if (_audioBlob) { URL.revokeObjectURL(_audioBlob); _audioBlob = null; }
      showReview(_entries);
      // 若服务端没有音频，直接弹出文件选择框让用户配对
      if (!m.has_audio) {
        setTimeout(() => {
          const inp = document.getElementById('ASO_AUDIO_INPUT');
          if (inp) inp.click();
        }, 400);
      }
      break;

    case 'translate_done':
      applyTranslation(m.entry_id, m.translations, m);
      break;

    case 'translate_started':
      // 服务端开始自动翻译，前端显示进度提示
      // 重新翻译期间不覆盖前端已设定的 running 状态，避免 race condition 重置进度计数
      if (_retranslateVisualRunning) {
        // 仅用服务端 count 修正 total（前端估算可能和服务端实际入队数有差），但保持 running
        if (m.count > 0) _translateAllTotal = m.count;
        _translateAllRunning = _translateAllTotal > 0;
      } else {
        _translateAllTotal = m.count || 0;
        _translateAllRunning = _translateAllTotal > 0;
      }
      if (_retranslateVisualRunning) {
        setPhase(2);
        const sub = document.getElementById('SUB_WRAP');
        if (sub) sub.classList.remove('visible');
        const exp = document.getElementById('EXPORT_BAR');
        if (exp) exp.classList.remove('visible');
        sciShow('p2');
      }
      _updateTranslateProgress();
      break;

    case 'job_status':
      if (m.status === 'idle') {
        stopJobPolling();
        const cb = document.getElementById('BTN_CANCEL');
        if (cb) { cb.disabled = false; cb.textContent = tr('prog.cancel'); }
        // “新文件”或“取消”后仅短暂显示状态提示，随后恢复到初始拖拽框界面。
        updateProgressTransient(0, trMsg(m.msg || '已取消'), 2000);
      }
      break;

    case 'error':
      document.getElementById('PROG_LBL').textContent = tr('msg.error_prefix') + trMsg(m.msg||'').slice(0,80);
      document.getElementById('PROG_BAR').style.background = 'var(--red)';
      break;
  }
}

function handleLlmDone(m) {
  stopJobPolling();
  const entries = Array.isArray(m.entries) ? m.entries : [];
  if (m.segments) _segments = m.segments;
  if (m.raw_text !== undefined) _rawText = m.raw_text || '';
  _entries = entries;
  if (!m.diarize_running) {
    setPhase(4);
    updateProgress(100, trMsg(m.msg || `完成（${entries.length} 条）`));
    let reviewShown = false;
    const showOnce = () => {
      if (reviewShown) return;
      reviewShown = true;
      showReview(entries);
    };
    sciFinishThen(showOnce);
    // Safety net: if the sci-fi fade timer is interrupted by late translation
    // events or pywebview timing, still force the review/playback UI to appear.
    setTimeout(showOnce, 1500);
  }
}

function handleDiarizeDone(m) {
  stopJobPolling();
  const entries = Array.isArray(m.entries) ? m.entries : [];
  if (m.segments) _segments = m.segments;
  if (m.raw_text !== undefined) _rawText = m.raw_text || '';
  _entries = entries;
  rememberSpeakerOrderFromEntries(entries, true);
  setPhase(4);
  const nSpk = m.n_speakers || 0;
  const errNote = m.error ? tr('msg.diarize_partial') : '';
  updateProgress(100, trReplace('msg.diarize_complete', {N: nSpk}) + errNote);
  sciFinishThen(() => showReview(entries));
  updateSpeakerPanel(entries);
  const bd = document.getElementById('BTN_DIARIZE');
  const br = document.getElementById('BTN_RECLUSTER');
  if (bd) { bd.disabled = false; bd.textContent = tr('panel.diarize_redo'); }
  if (br) { br.disabled = false; br.textContent = tr('panel.diarize_recluster'); }
}

// ── Phase bar ─────────────────────────────────────────────────
function setPhase(n) {
  _currentPhase = n;
  // Map logical phase names to step indices (0..4)
  const phMap = {asr:1, llm:2, diarize:3, review:4};
  if (typeof n === 'string') n = phMap[n] ?? 0;
  document.querySelectorAll('.phase-step').forEach((el,i) => {
    el.classList.remove('done','active');
    if (i < n)  el.classList.add('done');
    if (i === n) el.classList.add('active');
  });
}


// ── Sci-fi processing preview ─────────────────────────────────
const SCI_MAX_CHARS = 5200;
function sciStageLabel(stage) {
  const map = {
    asr: 'ASR STREAM',
    p1: 'LLM PHASE I',
    llm_p1: 'LLM PHASE I',
    p2: 'LLM PHASE II',
    llm_p2: 'LLM PHASE II',
    diarize: 'DIARIZATION',
    boot: 'SYSTEM BOOT'
  };
  return map[stage] || String(stage || 'PROCESSING').toUpperCase();
}
function sciShow(stage='boot') {
  const p = document.getElementById('SCI_PREVIEW');
  const st = document.getElementById('SCI_STAGE');
  if (!p) return;
  if (_sciFadeTimer) { clearTimeout(_sciFadeTimer); _sciFadeTimer = null; }
  p.classList.remove('fading');
  p.classList.add('visible');
  if (stage) _sciStage = stage;
  if (st) st.textContent = sciStageLabel(_sciStage);
  updateSciModeButton();
}
function sciSetStage(stage, clear=false) {
  if (!stage) return;
  const normalized = (stage === 'llm') ? (_sciStage && _sciStage.startsWith('llm') ? _sciStage : 'p1') : stage;
  if (normalized !== _sciStage) {
    _sciStage = normalized;
    if (clear) _sciText = '';
  }
  sciShow(_sciStage);
  const st = document.getElementById('SCI_STAGE');
  if (st) st.textContent = sciStageLabel(_sciStage);
  sciRender();
}
let _sciLastRendered = null;   // 避免相同内容重复赋值 textContent（会重置 CSS animation）
function sciModeName(mode) {
  return mode === 'matrix' ? tr('sci.mode_matrix') : tr('sci.mode_aurora');
}
function updateSciModeButton() {
  const p = document.getElementById('SCI_PREVIEW');
  const bar = document.getElementById('SCI_MODE_BAR');
  const btn = document.getElementById('SCI_MODE_BTN');
  if (p) p.classList.toggle('matrix', _sciMode === 'matrix');
  if (bar) bar.classList.toggle('visible', !!(p && p.classList.contains('visible')));
  if (btn) {
    btn.textContent = trReplace('sci.mode_button', {'{mode}': sciModeName(_sciMode)});
    btn.title = tr('sci.mode_title');
  }
}
function toggleSciMode() {
  _sciMode = (_sciMode === 'matrix') ? 'aurora' : 'matrix';
  localStorage.setItem('asr_offline_sci_mode', _sciMode);
  _sciSparkSalt = Math.floor(Math.random() * 10000);
  _sciLastRendered = null;
  updateSciModeButton();
  sciRender();
}
function sciHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function sciRand(seed) {
  let x = (seed >>> 0) || 1;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  return (x >>> 0) / 4294967295;
}
function sciCharUnits(ch) {
  // Approximate visual width in a monospaced mixed CJK/Latin line.
  // This lets the Matrix effect create independent animated rows rather than one animation over a whole paragraph.
  if (!ch) return 0;
  const code = ch.codePointAt(0);
  if (code === 9) return 4; // tab
  if (code >= 0x1100 && (
      code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6))) return 1.85;
  return 1;
}
function sciMatrixRows(display) {
  const el = document.getElementById('SCI_TEXT');
  const pxPerUnit = 8.4;
  const maxUnits = Math.max(18, Math.floor(((el && el.clientWidth) || 680) / pxPerUnit));
  const rows = [];
  String(display).split('\n').forEach((paragraph) => {
    if (!paragraph) { rows.push(' '); return; }
    let row = '';
    let units = 0;
    for (const ch of paragraph) {
      const u = sciCharUnits(ch);
      if (row && units + u > maxUnits) {
        rows.push(row);
        row = ch;
        units = u;
      } else {
        row += ch;
        units += u;
      }
    }
    rows.push(row || ' ');
  });
  return rows;
}
function sciMatrixHTML(display) {
  return sciMatrixRows(display).map((line, idx) => {
    const safe = esc(line || ' ');
    const base = sciHash(line + '|' + idx + '|' + _sciSparkSalt);
    const n = 1 + Math.floor(sciRand(base) * 3);
    let sparks = '';
    for (let i = 0; i < n; i++) {
      const r1 = sciRand(base + i * 101 + 7);
      const r2 = sciRand(base + i * 101 + 17);
      const r3 = sciRand(base + i * 101 + 31);
      const r4 = sciRand(base + i * 101 + 43);
      const dur = (2.95 + r1 * 0.95).toFixed(2) + 's';
      const delay = (-r2 * 4.2).toFixed(2) + 's';
      const size = (225 + r3 * 70).toFixed(0) + '%';
      const start = (150 + r4 * 34).toFixed(0) + '%';
      const end = (-150 - r4 * 34).toFixed(0) + '%';
      sparks += `<span class="sci-spark" style="--dur:${dur};--delay:${delay};--size:${size};--start:${start};--end:${end}">${safe}</span>`;
    }
    return `<span class="sci-line"><span class="sci-line-text">${safe}</span>${sparks}</span>`;
  }).join('');
}
function sciRender() {
  const el = document.getElementById('SCI_TEXT');
  if (!el) return;
  const txt = (_sciText || '').trim();
  const display = txt || 'Initializing acoustic matrix...\nWaiting for decoded text stream...';
  const renderKey = _sciMode + '::' + display;
  if (renderKey !== _sciLastRendered) {
    if (_sciMode === 'matrix') el.innerHTML = sciMatrixHTML(display);
    else el.textContent = display;
    _sciLastRendered = renderKey;
  }
  el.classList.toggle('sci-empty', !txt);
  el.scrollTop = el.scrollHeight;
  updateSciModeButton();
}
function sciSetText(text, stage) {
  if (stage) sciSetStage(stage, _sciStage && stage !== _sciStage);
  _sciText = String(text || '').slice(-SCI_MAX_CHARS);
  sciShow(stage || _sciStage || 'boot');
  sciRender();
}
function sciAppend(text, stage) {
  if (stage) sciSetStage(stage, _sciStage && stage !== _sciStage);
  const t = String(text || '').trim();
  if (!t) { sciShow(stage || _sciStage || 'boot'); sciRender(); return; }
  _sciText = ((_sciText ? _sciText + '\n' : '') + t).slice(-SCI_MAX_CHARS);
  sciShow(stage || _sciStage || 'boot');
  sciRender();
}
function sciReplaceLast(text, stage) {
  // 替换 _sciText 最后一行（同一时间窗口内原地增长），而不是追加新行
  if (stage) sciSetStage(stage, _sciStage && stage !== _sciStage);
  const t = String(text || '').trim();
  if (!t) return;
  const lines = _sciText ? _sciText.split('\n') : [];
  if (lines.length > 0) {
    lines[lines.length - 1] = t;
  } else {
    lines.push(t);
  }
  _sciText = lines.join('\n').slice(-SCI_MAX_CHARS);
  sciShow(stage || _sciStage || 'boot');
  sciRender();
}
function sciReset(stage='boot', seed='') {
  sciStopAsrQueue();
  sciStopAsrSim();
  _sciStage = stage;
  _sciText = seed || '';
  _sciAsrSimSec = 0;
  sciShow(stage);
  sciRender();
}
function sciHideNow() {
  if (_sciFadeTimer) { clearTimeout(_sciFadeTimer); _sciFadeTimer = null; }
  sciStopAsrQueue();
  sciStopAsrSim();
  const p = document.getElementById('SCI_PREVIEW');
  if (p) { p.classList.remove('visible','fading'); }
  _sciText = ''; _sciStage = ''; _sciAsrSimSec = 0;
  const el = document.getElementById('SCI_TEXT'); if (el) el.textContent = '';
  const bar = document.getElementById('SCI_MODE_BAR'); if (bar) bar.classList.remove('visible');
}
function sciFinishThen(cb) {
  const p = document.getElementById('SCI_PREVIEW');
  if (!p || !p.classList.contains('visible')) { if (cb) cb(); return; }
  if (_sciFadeTimer) clearTimeout(_sciFadeTimer);
  p.classList.add('fading');
  _sciFadeTimer = setTimeout(() => {
    p.classList.remove('visible','fading');
    const bar = document.getElementById('SCI_MODE_BAR'); if (bar) bar.classList.remove('visible');
    _sciFadeTimer = null;
    if (cb) cb();
  }, 720);
}
function sciEntryPreview(e) {
  if (!e) return '';
  let out = e.corrected || '';
  const trans = e.translations || {};
  for (const [lang, text] of Object.entries(trans)) {
    if (text) out += `\n${langDisplayName(lang)}: ${text}`;
  }
  return out;
}

function sciStopAsrQueue() {
  if (_sciAsrQueueTimer) {
    clearInterval(_sciAsrQueueTimer);
    _sciAsrQueueTimer = null;
  }
  _sciAsrQueue = [];
}

function sciQueueAsrPreview(text, clear=false, replace=false) {
  // ASR recognition itself remains full-context and accurate. These batches
  // are only played back gradually in the sci-fi panel so they do not flash all
  // at once when the worker returns complete Whisper/SenseVoice segments.
  if (clear || replace) {
    sciStopAsrQueue();
    sciSetText('', 'asr');
  }
  const t = String(text || '').trim();
  if (!t) return;
  _sciAsrQueue.push(t);
  sciStartAsrQueue();
}

function sciStartAsrQueue() {
  if (_sciAsrQueueTimer) return;
  _sciAsrQueueTimer = setInterval(() => {
    if (!_sciAsrQueue.length || _sciStage !== 'asr') {
      sciStopAsrQueue();
      return;
    }
    sciAppend(_sciAsrQueue.shift(), 'asr');
    if (!_sciAsrQueue.length) sciStopAsrQueue();
  }, 850);
}

function sciStartAsrSim() {
  if (_sciAsrSimTimer) return;
  sciShow('asr');
  _sciAsrSimTimer = setInterval(() => {
    if (_sciStage !== 'asr') { sciStopAsrSim(); return; }
    _sciAsrSimSec += 20;
    const st = Math.max(0, _sciAsrSimSec - 20);
    const en = _sciAsrSimSec;
    const pad = n => String(n).padStart(4, '0');
    sciAppend(`[${pad(st)}–${pad(en)}s] decoding acoustic window · aligning tokens · estimating timestamps ...`, 'asr');
  }, 1100);
}

function sciStopAsrSim() {
  if (_sciAsrSimTimer) {
    clearInterval(_sciAsrSimTimer);
    _sciAsrSimTimer = null;
  }
}

// ── Progress ─────────────────────────────────────────────────
let _progHideTimer = null;
function hideProgressAfter(ms = 1200) {
  if (_progHideTimer) clearTimeout(_progHideTimer);
  _progHideTimer = setTimeout(() => {
    const w = document.getElementById('PROG');
    if (w) w.classList.remove('visible');
    _progHideTimer = null;
  }, ms);
}
function updateProgress(pct, label) {
  const w = document.getElementById('PROG');
  if (_progHideTimer) { clearTimeout(_progHideTimer); _progHideTimer = null; }
  w.classList.add('visible');
  document.getElementById('PROG_BAR').style.width = pct + '%';
  document.getElementById('PROG_LBL').textContent = trMsg(label);
  if (pct >= 100) hideProgressAfter(1200);
}
function updateProgressTransient(pct, label, ms = 2000) {
  const w = document.getElementById('PROG');
  if (!w) return;
  if (_progHideTimer) { clearTimeout(_progHideTimer); _progHideTimer = null; }
  w.classList.add('visible');
  document.getElementById('PROG_BAR').style.width = pct + '%';
  document.getElementById('PROG_LBL').textContent = trMsg(label);
  hideProgressAfter(ms);
}

// ── File upload ───────────────────────────────────────────────
function onDragOver(e) {
  e.preventDefault();
  document.getElementById('DROP').classList.add('drag-over');
}
function onDragLeave() {
  document.getElementById('DROP').classList.remove('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('DROP').classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f) uploadFile(f);
}
function onFileSelected(f) { if(f) uploadFile(f); }

async function uploadFile(file) {
  updateProgress(5, tr('msg.checking_file'));
  const fd = new FormData();
  fd.append('file', file, file.name);
  try {
    const r = await fetch('/api/upload', {method:'POST', body: fd});
    const j = await r.json();
    if (!j.ok) {
      updateProgress(0, tr('msg.error_prefix') + (j.error||tr('msg.error_check')));
      document.getElementById('PROG_BAR').style.background = 'var(--red)';
    }
    // file_ready event will call showFileCard
  } catch(e) {
    updateProgress(0, tr('msg.error_prefix') + e.message);
  }
}

function showFileCard(info) {
  document.getElementById('DROP').style.display = 'none';
  const card = document.getElementById('FILE_CARD');
  card.classList.add('visible');
  document.getElementById('FC_NAME').textContent = info.filename || '(unknown)';

  // Meta
  const dur = info.duration || 0;
  const h=Math.floor(dur/3600), m=Math.floor((dur%3600)/60), s=Math.floor(dur%60);
  const durStr = h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
                   : `${m}:${String(s).padStart(2,'0')}`;
  document.getElementById('FC_META').innerHTML = [
    `<span>${tr('fc.duration')} <b>${durStr}</b></span>`,
    `<span>${tr('fc.format')} <b>${(info.codec||'').toUpperCase()}</b></span>`,
    `<span>${tr('fc.bitrate')} <b>${info.bitrate||0} kbps</b></span>`,
    `<span>${tr('fc.samplerate')} <b>${info.sample_rate||0} Hz</b></span>`,
    `<span>${tr('fc.channels')} <b>${info.channels||0}</b></span>`,
    `<span>${tr('fc.size')} <b>${info.size_mb||0} MB</b></span>`,
  ].join('');

  // Warn if very short or no audio codec
  const warn = document.getElementById('FC_WARN');
  if (!info.codec || info.duration < 1) {
    warn.textContent = tr('fc.warn');
    warn.classList.add('visible');
  } else {
    warn.classList.remove('visible');
  }

  document.getElementById('BTN_START').disabled = !_ready;
  if (_progHideTimer) { clearTimeout(_progHideTimer); _progHideTimer = null; }
  document.getElementById('PROG').classList.remove('visible');
  setPhase(0);
}

async function startJob() {
  if (!_ready) { alert(tr('msg.alert_warmup')); return; }
  const startBtn = document.getElementById('BTN_START');
  if (startBtn) { startBtn.disabled = true; startBtn.textContent = tr('fc.btn_start_running'); }
  setPhase(1);
  updateProgress(10, tr('msg.asr_running'));
  // hide upload area, show visual processing area; real subtitle cards appear only after completion
  document.getElementById('DROP_OUTER').style.display = 'none';
  document.getElementById('SUB_WRAP').classList.remove('visible');
  document.getElementById('SUB_WRAP').innerHTML = '';
  sciReset('asr', 'Initializing acoustic matrix...\nListening for decoded text stream...');
  document.getElementById('BTN_NEW').style.display = '';
  document.getElementById('BTN_NEW').disabled = true;
  const r = await fetch('/api/start', {method:'POST'});
  const j = await r.json();
  if (!j.ok) {
    stopJobPolling();
    updateProgress(0, tr('msg.error_prefix')+(j.error||tr('msg.error_start')));
    if (startBtn) { startBtn.disabled = false; startBtn.textContent = tr('fc.btn_start'); }
  } else {
    startJobPolling();
  }
}

function startJobPolling() {
  stopJobPolling();
  _jobPollTimer = setInterval(async () => {
    try {
      const r = await fetch('/api/status', {cache:'no-store'});
      if (!r.ok) return;
      const st = await r.json();
      if (st.status === 'review') {
        const er = await fetch('/api/entries', {cache:'no-store'});
        if (er.ok) {
          const entries = await er.json();
          // Check if entries have speaker info → call handleDiarizeDone path
          const hasSpeakers = Array.isArray(entries) && entries.some(e => e.speaker);
          if (hasSpeakers) {
            handleDiarizeDone({entries, n_speakers: new Set(entries.map(e=>e.speaker).filter(Boolean)).size});
          } else {
            handleLlmDone({type:'llm_done', entries, msg:`完成（${Array.isArray(entries)?entries.length:0} 条）`});
          }
        }
      } else if (st.status === 'error' || st.status === 'idle') {
        stopJobPolling();
      }
    } catch(e) {}
  }, 1200);
}

function stopJobPolling() {
  if (typeof _jobPollTimer !== 'undefined' && _jobPollTimer) {
    clearInterval(_jobPollTimer);
    _jobPollTimer = null;
  }
}

function resetUpload() {
  stopJobPolling();
  document.getElementById('DROP').style.display = '';
  document.getElementById('FILE_CARD').classList.remove('visible');
  document.getElementById('FILE_INPUT').value = '';
  resetStartButton(true);
  document.getElementById('PROG').classList.remove('visible');
  sciHideNow();
}

// ── Review ────────────────────────────────────────────────────
async function showReview(entries) {
  _entries = entries;
  sciHideNow();   // 确保进入校对阶段时科幻面板立即隐藏，不残留
  document.getElementById('DROP_OUTER').style.display = 'none';
  document.getElementById('PROG').classList.remove('visible');
  document.getElementById('BTN_NEW').style.display = '';
  document.getElementById('BTN_NEW').disabled = false;
  const btnSave = document.getElementById('BTN_SAVE');
  if (btnSave) btnSave.style.display = '';
  document.getElementById('EXPORT_BAR').classList.add('visible');
  rememberSpeakerOrderFromEntries(entries, true);
  renderEntries(entries);
  document.getElementById('SUB_WRAP').classList.add('visible');
  setPhase(4);
  if (entries.some(e => e.speaker)) updateSpeakerPanel(entries);
  if (!_audioLoaded) {
    try {
      // 用 HEAD 请求检查 /api/audio 是否可用，再挂载 URL（无需下载整个文件）
      const r = await fetch('/api/audio', { method: 'HEAD' });
      if (r.ok) initPlayer(null);
    } catch(e) {}
  }
}


// ── Subtitle search / filter ─────────────────────────────────
function subtitleSearchMode() {
  return document.getElementById('SUB_SEARCH_MODE')?.value || 'text';
}
function subtitleSearchQuery() {
  const mode = subtitleSearchMode();
  if (mode === 'speaker') return document.getElementById('SUB_SEARCH_SPEAKER')?.value || '';
  return document.getElementById('SUB_SEARCH_INPUT')?.value || '';
}
function entrySearchBlob(e) {
  const trans = e && e.translations ? Object.values(e.translations).join('\n') : '';
  return [e?.corrected, e?.text, e?.asr_raw, trans, e?.language, e?.emotion, e?.speaker]
    .filter(v => v !== undefined && v !== null).join('\n');
}
function regexEscape(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function hasSearchLogicOperators(q) {
  // Logical operators are recognized only when surrounded by whitespace.
  // Examples: "同志 AND 主义", "patent OR claim". Case-insensitive.
  return /\s+(?:AND|OR)\s+/i.test(String(q || ''));
}
function splitRegexLogicExpression(q) {
  // Keeps the original regex mode intact. If no AND/OR operator is present,
  // the whole query is treated as a normal JavaScript regular expression.
  q = String(q || '').trim();
  if (!hasSearchLogicOperators(q)) {
    const single = new RegExp(q, 'i');
    const highlight = new RegExp(q, 'gi');
    return {kind: 'single', single, highlight};
  }

  const parts = q.split(/\s+(AND|OR)\s+/i).map(x => String(x || '').trim()).filter(x => x !== '');
  if (!parts.length || parts.length % 2 === 0) throw new Error('Invalid logical regex expression');

  const groups = [[]];
  const highlightTerms = [];
  let pendingOp = null;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      const op = part.toUpperCase();
      if (op !== 'AND' && op !== 'OR') throw new Error('Invalid logical operator');
      pendingOp = op;
      continue;
    }
    if (!part) throw new Error('Empty regex term');
    const termRe = new RegExp(part, 'i');
    if (pendingOp === 'OR') groups.push([]);
    groups[groups.length - 1].push(termRe);
    highlightTerms.push(part);
  }
  if (!groups.length || groups.some(g => !g.length)) throw new Error('Invalid logical regex expression');

  let highlight = null;
  if (highlightTerms.length) {
    highlight = new RegExp(highlightTerms.map(t => `(?:${t})`).join('|'), 'gi');
  }
  return {kind: 'logic', groups, highlight};
}
function currentSearchRegexForHighlight() {
  const q = subtitleSearchQuery().trim();
  const mode = subtitleSearchMode();
  if (!q || mode === 'speaker') return null;
  try {
    if (mode === 'regex') return splitRegexLogicExpression(q).highlight;
    return new RegExp(regexEscape(q), 'gi');
  } catch(e) { return null; }
}
function highlightSearchText(text, re) {
  text = String(text ?? '');
  if (!re) return esc(text);
  let out = '', last = 0, m, guard = 0;
  try {
    re.lastIndex = 0;
    while ((m = re.exec(text)) && guard++ < 300) {
      if (!m[0]) { re.lastIndex++; continue; }
      out += esc(text.slice(last, m.index));
      out += `<mark class="search-hit">${esc(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    out += esc(text.slice(last));
    return out;
  } catch(e) { return esc(text); }
}
function filterSubtitleEntries(entries) {
  entries = Array.isArray(entries) ? entries : [];
  const q = subtitleSearchQuery().trim();
  const mode = subtitleSearchMode();
  const err = document.getElementById('SUB_SEARCH_ERR');
  if (err) err.textContent = '';
  if (!q) return entries.map((e, idx) => ({e, idx}));
  if (mode === 'speaker') {
    const needle = q.toLowerCase();
    return entries.map((e, idx) => ({e, idx})).filter(x => String(x.e?.speaker || '').toLowerCase() === needle);
  }
  if (mode === 'regex') {
    let parsed;
    try { parsed = splitRegexLogicExpression(q); }
    catch(e) {
      if (err) err.textContent = tr('search.regex_error');
      return [];
    }
    return entries.map((e, idx) => ({e, idx})).filter(x => {
      const blob = entrySearchBlob(x.e);
      if (parsed.kind === 'single') return parsed.single.test(blob);
      // OR of AND-groups: "A AND B OR C" means (A && B) || C.
      return parsed.groups.some(group => group.every(re => re.test(blob)));
    });
  }
  const needle = q.toLowerCase();
  return entries.map((e, idx) => ({e, idx})).filter(x => entrySearchBlob(x.e).toLowerCase().includes(needle));
}
function updateSubtitleSearchUI(total, shown) {
  const bar = document.getElementById('SUB_SEARCH_BAR');
  if (bar) bar.classList.toggle('visible', total > 0);
  updateSubtitleSpeakerOptions();
  const mode = subtitleSearchMode();
  const input = document.getElementById('SUB_SEARCH_INPUT');
  const spSel = document.getElementById('SUB_SEARCH_SPEAKER');
  if (input) {
    input.style.display = mode === 'speaker' ? 'none' : '';
    input.placeholder = tr(mode === 'regex' ? 'search.placeholder_regex' : 'search.placeholder_text');
  }
  if (spSel) spSel.style.display = mode === 'speaker' ? '' : 'none';
  const cnt = document.getElementById('SUB_SEARCH_COUNT');
  if (cnt) cnt.textContent = total ? tr('search.count').replace('N', shown).replace('M', total) : '';
}
function updateSubtitleSpeakerOptions() {
  const sel = document.getElementById('SUB_SEARCH_SPEAKER');
  if (!sel) return;
  const cur = sel.value;
  const names = [];
  (_speakerOrder || []).forEach(s => { if (s && !names.includes(s)) names.push(s); });
  (_entries || []).forEach(e => { const s = e && e.speaker; if (s && !names.includes(s)) names.push(s); });
  sel.innerHTML = names.length
    ? names.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')
    : `<option value="">${esc(tr('search.no_speaker'))}</option>`;
  if (names.includes(cur)) sel.value = cur;
}
function onSubtitleSearchModeChanged() {
  updateSubtitleSearchUI((_entries||[]).length, (_entries||[]).length);
  renderEntries(_entries);
}
function onSubtitleSearchChanged() { renderEntries(_entries); }
function clearSubtitleSearch() {
  const modeSel = document.getElementById('SUB_SEARCH_MODE');
  if (modeSel) modeSel.value = 'text';
  const input = document.getElementById('SUB_SEARCH_INPUT');
  if (input) input.value = '';
  const err = document.getElementById('SUB_SEARCH_ERR');
  if (err) err.textContent = '';
  renderEntries(_entries);
}

function renderEntries(entries) {
  entries = Array.isArray(entries) ? entries : [];
  const wrap = document.getElementById('SUB_WRAP');
  const filtered = filterSubtitleEntries(entries);
  updateSubtitleSearchUI(entries.length, filtered.length);
  wrap.innerHTML = '';
  if (!entries.length) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--hi);padding:40px">${tr('entry.no_content')}</div>`;
    return;
  }
  if (!filtered.length) {
    wrap.innerHTML = `<div style="text-align:center;color:var(--hi);padding:40px">${tr('search.no_match')}</div>`;
    return;
  }
  filtered.forEach(({e, idx}) => {
    const el = document.createElement('div');
    el.className = 'entry';
    el.dataset.idx = idx;
    el.innerHTML = _entryHTML(e, idx);
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('button,select,input,textarea,.orig-edit,[contenteditable=true]')) return;
      seekToEntry(idx);
    });
    wrap.appendChild(el);
  });
}

function resetSpeakerColorState() {
  _speakerColorMap = {};
  _speakerOrder = [];
}

function rememberSpeakerOrderFromEntries(entries, reset=false) {
  if (reset || !_speakerColorMap || !Array.isArray(_speakerOrder)) resetSpeakerColorState();
  const seen = new Set(_speakerOrder);
  (entries || []).forEach(e => {
    const spk = e && e.speaker;
    if (spk && !seen.has(spk)) {
      _speakerOrder.push(spk);
      seen.add(spk);
    }
  });
}

function _speakerClass(name) {
  if (!name) return '';
  // Speaker color is based on the stable sidebar order, not alphabetical order.
  // This prevents colors from shifting after the user renames a speaker.
  if (!_speakerColorMap || !Array.isArray(_speakerOrder)) resetSpeakerColorState();
  if (!_speakerOrder.includes(name)) _speakerOrder.push(name);
  if (!_speakerColorMap[name]) {
    const idx = Math.max(0, _speakerOrder.indexOf(name));
    _speakerColorMap[name] = 'spk-' + ((idx % 8) + 1);
  }
  return _speakerColorMap[name];
}

function _entryHTML(e, idx) {
  const ts    = e.start !== undefined ? `${fmt(e.start)} → ${fmt(e.end)}` : '';
  const lang  = e.language || '';
  const emo   = e.emotion  || '';
  const spk   = e.speaker  || '';
  const trans = e.translations || {};
  const searchRe = currentSearchRegexForHighlight();
  const transHtml = Object.entries(trans).map(([l,t]) =>
    `<div class="trans-line">${langTag(l)}${highlightSearchText(t, searchRe)}</div>`
  ).join('');

  const _micSvg = '<svg class="svg-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;margin-right:2px;flex-shrink:0"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="21" x2="12" y2="17"/><line x1="8" y1="21" x2="16" y2="21"/></svg>';
  const spkBadge = spk
    ? `<span class="spk-badge ${_speakerClass(spk)}"
          onclick="event.stopPropagation();openSpkPopup(event,'${esc(spk)}')"
          title="${tr('spk.rename_tooltip')}">${_micSvg}${esc(spk)}</span>`
    : '';

  // v0.4g: ASR 原始文字隐藏层（含锚定时间戳）
  const asrRaw  = e.asr_raw || '';
  const asrTsS  = (e.asr_ts_start !== undefined) ? fmtDebugTime(e.asr_ts_start) : null;
  const asrTsE  = (e.asr_ts_end   !== undefined) ? fmtDebugTime(e.asr_ts_end)   : null;
  const asrTs   = (asrTsS && asrTsE) ? `${asrTsS} → ${asrTsE}` : '';
  const tsMatch = (e.asr_ts_start === undefined) ||
                  (Math.abs((e.start||0)-(e.asr_ts_start||0)) < 0.005 &&
                   Math.abs((e.end  ||0)-(e.asr_ts_end  ||0)) < 0.005);
  const asrRawHtml = asrRaw
    ? `<div class="asr-raw-layer" id="asr-raw-${idx}">
        <div class="asr-raw-label">${tr('entry.asr_anchor_time')} ${esc(asrTs)} ${!tsMatch?'<span style=\"color:var(--red)\">'+tr('entry.asr_ts_mismatch')+'</span>':''}</div>
        <div class="asr-raw-text">${highlightSearchText(asrRaw, searchRe)}</div>
       </div>` : '';

  return `
    <div class="entry-top">
      ${ts ? `<span class="entry-ts">${ts}</span>` : ''}
      ${lang ? `<span class="entry-lang">${lang}</span>` : ''}
      ${emo  ? `<span class="entry-emo">${emo.toLowerCase()}</span>` : ''}
      ${spkBadge}
      <span class="entry-num">#${idx+1}</span>
    </div>
    <div class="entry-text" id="entry-text-${idx}">${highlightSearchText(e.corrected||'', searchRe)}</div>
    ${asrRawHtml}
    ${transHtml ? `<div class="entry-trans">${transHtml}</div>` : ''}
    <div class="entry-actions">
      <button class="act-btn" onclick="event.stopPropagation();startEdit(${idx})">${tr('entry.btn_edit')}</button>
      <button class="act-btn" onclick="event.stopPropagation();translateEntry(${idx})">${tr('entry.btn_translate')}</button>
      ${asrRaw ? `<button class="act-btn asr-raw-toggle" onclick="event.stopPropagation();toggleAsrRaw(${idx})">${tr('entry.btn_raw')}</button>` : ''}
    </div>`;
}

function toggleAsrRaw(idx) {
  const layer = document.getElementById(`asr-raw-${idx}`);
  if (layer) layer.classList.toggle('visible');
}

// ── 调试面板 ─────────────────────────────────────────────────────────
function copyDebugPanel() {
  const body = document.getElementById('DBG_BODY');
  if (!body) return;
  // Extract plain text from the panel (strip HTML tags)
  const text = body.innerText || body.textContent || '';
  if (!text.trim()) { return; }
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('BTN_DBG_COPY');
    if (btn) { const orig = btn.textContent; btn.textContent = '✅ ' + tr('dbg.btn_copy_done'); setTimeout(() => btn.textContent = orig, 1800); }
  }).catch(() => {
    // Fallback: select + execCommand
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
  });
}

function toggleDebugPanel() {
  const p = document.getElementById('DEBUG_PANEL');
  const btn = document.getElementById('BTN_DEBUG');
  if (!p) return;
  const shown = p.style.display !== 'none';
  p.style.display = shown ? 'none' : 'block';
  if (btn) {
    const arr = document.getElementById('BUG_BTN_ARROW'); if(arr) arr.textContent = shown ? '▲' : '▼';
    btn.title       = shown ? '展开调试面板' : '收起调试面板';
  }
  if (!shown) showDebugTimestamps(); // 展开时默认显示时间戳对比
}

function fmtDebugTime(t) {
  if (t === undefined || t === null) return '??';
  const s = Number(t);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function buildDebugSnapshot() {
  const entries = Array.isArray(_entries) ? _entries : [];
  const segments = Array.isArray(_segments) ? _segments : [];
  const audioDuration = _audioEl ? (_audioEl.duration || 0) : 0;
  return {
    saved_at: new Date().toISOString(),
    asr_raw_text: _rawText || '',
    asr_raw_length: (_rawText || '').length,
    asr_segments: segments,
    asr_segments_count: segments.length,
    segments_have_word_timestamps: !!(segments[0] && segments[0].words && segments[0].words.length),
    audio_duration: audioDuration || null,
    timestamp_compare: entries.map((e, i) => {
      const start = Number(e.start || 0);
      const end = Number(e.end || 0);
      const asrStart = Number(e.asr_ts_start ?? start);
      const asrEnd = Number(e.asr_ts_end ?? end);
      return {
        index: i + 1,
        entry_id: e.id ?? i,
        speaker: e.speaker || '',
        start,
        end,
        start_fmt: fmtDebugTime(start),
        end_fmt: fmtDebugTime(end),
        asr_ts_start: asrStart,
        asr_ts_end: asrEnd,
        asr_ts_start_fmt: fmtDebugTime(asrStart),
        asr_ts_end_fmt: fmtDebugTime(asrEnd),
        timestamp_match: Math.abs(start - asrStart) < 0.005 && Math.abs(end - asrEnd) < 0.005,
        corrected: e.corrected || '',
        asr_raw: e.asr_raw || '',
      };
    }),
  };
}

function clearDebugPanelUI() {
  _segments = [];
  _rawText = '';
  const panel = document.getElementById('DEBUG_PANEL');
  const body = document.getElementById('DBG_BODY');
  const backend = document.getElementById('DBG_BACKEND');
  const btn = document.getElementById('BTN_DEBUG');
  const arr = document.getElementById('BUG_BTN_ARROW');
  if (body) body.innerHTML = '';
  if (backend) backend.textContent = '';
  if (panel) panel.style.display = 'none';
  if (arr) arr.textContent = '▲';
  if (btn) btn.title = tr('export.btn_debug_title_open');
}

function showDebugRaw() {
  const body = document.getElementById('DBG_BODY');
  if (!body) return;
  const backend = document.getElementById('DBG_BACKEND');
  if (backend) backend.textContent = '';
  let out = '<span style="color:var(--ac)">── ASR 原始文字 ──</span>\n\n';
  out += '<span style="color:var(--tx)">' + esc(_rawText || '（无）') + '</span>\n\n';
  out += `<span class="dbg-ts">共 ${(_rawText||'').length} 字符</span>`;
  body.innerHTML = out;
}

function showDebugSegments() {
  const body = document.getElementById('DBG_BODY');
  if (!body) return;
  if (!_segments || !_segments.length) {
    body.innerHTML = '<span style="color:var(--hi)">无 ASR Segments</span>';
    return;
  }
  let out = `<span style="color:var(--ac)">── ASR Segments（共 ${_segments.length} 段）──</span>\n\n`;
  for (let i = 0; i < _segments.length; i++) {
    const s = _segments[i];
    const words = s.words || [];
    const ts = fmtDebugTime(s.start) + ' → ' + fmtDebugTime(s.end);
    out += `<span class="dbg-seg">[${i+1}] ${ts}  (${words.length} words)</span>\n`;
    out += '<span style="color:var(--tx)">' + esc(s.text || '') + '</span>\n';
    if (words.length && words.length <= 30) {
      out += '<span class="dbg-ts">';
      words.forEach(w => {
        out += `  ${fmtDebugTime(w.start)}-${fmtDebugTime(w.end)} [${esc(w.word||'')}]`;
      });
      out += '</span>\n';
    } else if (words.length > 30) {
      out += `<span class="dbg-ts">  （${words.length} 词，仅显示前10/后5）\n`;
      words.slice(0,10).forEach(w => {
        out += `  ${fmtDebugTime(w.start)}-${fmtDebugTime(w.end)} [${esc(w.word||'')}]`;
      });
      out += '  …';
      words.slice(-5).forEach(w => {
        out += `  ${fmtDebugTime(w.start)}-${fmtDebugTime(w.end)} [${esc(w.word||'')}]`;
      });
      out += '</span>\n';
    }
    out += '\n';
  }
  body.innerHTML = out;
}

function showDebugTimestamps() {
  const body = document.getElementById('DBG_BODY');
  if (!body) return;
  if (!_entries || !_entries.length) {
    body.innerHTML = '<span style="color:var(--hi)">尚无字幕条目</span>';
    return;
  }
  const dur = _audioEl ? (_audioEl.duration || 0) : 0;
  let out = `<span style="color:var(--ac)">── 时间戳对比（${_entries.length} 条，音频时长 ${fmtDebugTime(dur)}）──</span>\n`;
  out += `<span class="dbg-ts">ASR backend: ${_segments.length ? _segments.length+'段' : '无segment'} | `;
  out += `Segments 有词级时间戳: ${(_segments[0]?.words?.length > 0) ? '✅是' : '❌否（整段估算）'}</span>\n\n`;

  for (let i = 0; i < _entries.length; i++) {
    const e = _entries[i];
    const ts    = fmtDebugTime(e.start) + ' → ' + fmtDebugTime(e.end);
    const asr_s = fmtDebugTime(e.asr_ts_start);
    const asr_e = fmtDebugTime(e.asr_ts_end);
    // 检查 start/end 与 asr_ts 是否一致
    const match = (Math.abs((e.start||0) - (e.asr_ts_start||0)) < 0.005 &&
                   Math.abs((e.end||0)   - (e.asr_ts_end||0))   < 0.005);
    const cls = match ? 'dbg-entry-ok' : 'dbg-entry-warn';
    out += `<span class="${cls}">#${i+1}  ${ts}  ${match ? '✅' : '⚠️ ASR:'+asr_s+'→'+asr_e}</span>\n`;
    out += `<span style="color:var(--tx)">  LLM: ${esc((e.corrected||'').slice(0,60))}${(e.corrected||'').length>60?'…':''}</span>\n`;
    if (e.asr_raw) {
      out += `<span class="dbg-ts">  ASR: ${esc((e.asr_raw||'').slice(0,80))}${(e.asr_raw||'').length>80?'…':''}</span>\n`;
    }
    out += '\n';
  }
  body.innerHTML = out;
}

function startEdit(idx) {
  const card = document.querySelector(`.entry[data-idx="${idx}"]`);
  const textEl = document.getElementById(`entry-text-${idx}`);
  if (!card || !textEl || card.classList.contains('editing')) return;
  card.classList.add('editing');
  const cur = _entries[idx]?.corrected || textEl.innerText || '';
  const ta = document.createElement('textarea');
  ta.className = 'orig-edit';
  ta.id = `entry-edit-${idx}`;
  ta.value = cur;
  ta.rows = Math.max(2, Math.ceil(cur.length / 42));
  textEl.replaceWith(ta);
  const actions = card.querySelector('.entry-actions');
  if (actions) actions.innerHTML = `
    <button class="act-btn" onclick="event.stopPropagation();commitEdit(${idx},false)">保存</button>
    <button class="act-btn" onclick="event.stopPropagation();commitEdit(${idx},true)">保存并翻译</button>
    <button class="act-btn" onclick="event.stopPropagation();cancelEdit(${idx})">取消</button>`;
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); cancelEdit(idx); } });
}

function cancelEdit(idx) {
  const card = document.querySelector(`.entry[data-idx="${idx}"]`);
  const ta = document.getElementById(`entry-edit-${idx}`);
  if (!card || !ta) return;
  const div = document.createElement('div');
  div.className = 'entry-text'; div.id = `entry-text-${idx}`;
  div.textContent = _entries[idx]?.corrected || '';
  ta.replaceWith(div);
  card.classList.remove('editing');
  const actions = card.querySelector('.entry-actions');
  if (actions) actions.innerHTML = `<button class="act-btn" onclick="event.stopPropagation();startEdit(${idx})">${tr('entry.btn_edit')}</button><button class="act-btn" onclick="event.stopPropagation();translateEntry(${idx})">${tr('entry.btn_translate')}</button>`;
}

function commitEdit(idx, doTranslate=false) {
  const card = document.querySelector(`.entry[data-idx="${idx}"]`);
  const ta = document.getElementById(`entry-edit-${idx}`);
  if (!card || !ta) return;
  const text = ta.value.trim();
  _entries[idx].corrected = text;
  const div = document.createElement('div');
  div.className = 'entry-text'; div.id = `entry-text-${idx}`;
  div.textContent = text;
  ta.replaceWith(div);
  card.classList.remove('editing');
  const actions = card.querySelector('.entry-actions');
  if (actions) actions.innerHTML = `<button class="act-btn" onclick="event.stopPropagation();startEdit(${idx})">${tr('entry.btn_edit')}</button><button class="act-btn" onclick="event.stopPropagation();translateEntry(${idx})">${tr('entry.btn_translate')}</button>`;
  fetch('/api/update_entry', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({idx, corrected: text})});
  if (doTranslate) translateEntry(idx);
}

function saveEdit(idx, el) { // backward compatibility
  const text = (el.innerText || el.value || '').trim();
  _entries[idx].corrected = text;
  fetch('/api/update_entry', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({idx, corrected: text})});
}

// ── Translation ───────────────────────────────────────────────
function translateEntry(idx) {
  const e = _entries[idx];
  const langs = _getTranslateLangs();
  fetch('/api/translate_entry', {method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      entry_id:     idx,
      text:         e.corrected || '',
      src_lang:     e.language  || '',
      translate_to: langs,
    })});
  const el = document.querySelector(`.entry[data-idx="${idx}"] .entry-text`);
  if (el) el.style.opacity = '.5';
}

/**
 * 获取当前应该翻译的目标语言列表。
 * 优先使用用户在 sidebar 中勾选的语言；
 * 若未勾选，默认使用中/英/日。
 */
function _getTranslateLangs() {
  const chips = [...document.querySelectorAll('.lang-chip.on')].map(c => c.dataset.lang);
  if (chips.length) return chips;
  return ['中文', '英文', '日文'];
}

async function retranslateAll() {
  if (_translateAllRunning) return;
  if (!_entries || !_entries.length) { alert(tr('msg.alert_need_correct')); return; }
  const langs = _getTranslateLangs();
  if (!langs.length) { alert(tr('msg.choose_translate_lang')); return; }
  const btn = document.getElementById('BTN_RETRANSLATE_ALL');
  if (btn) { btn.disabled = true; btn.textContent = '↻ ' + tr('panel.retranslate_running'); }

  // 同步设置，保证重新翻译、后续单句翻译和 ASO 保存使用同一组目标语言。
  saveSettings();

  // 重新翻译应当以用户当前选择的语言为准；先清空旧译文，避免旧语言残留。
  _entries.forEach(e => { e.translations = {}; });
  renderEntries(_entries);
  renderSingleLangList();

  _translateAllTotal = _entries.filter(e => (e.corrected || e.text || '').trim()).length;
  _translateAllDone = 0;
  _translateAllCompletedIds = new Set();
  _translateAllRunning = _translateAllTotal > 0;

  // 重新全文翻译期间隐藏字幕卡片，恢复进度条和科幻展示区；翻译完成后再淡出并返回字幕卡片。
  _retranslateVisualRunning = _translateAllRunning;
  if (_retranslateVisualRunning) {
    const sub = document.getElementById('SUB_WRAP');
    if (sub) sub.classList.remove('visible');
    const exp = document.getElementById('EXPORT_BAR');
    if (exp) exp.classList.remove('visible');
    // 显示进度条容器（review 阶段完成后 #PROG 被隐藏，需重新激活）
    const prog = document.getElementById('PROG');
    if (prog) prog.classList.add('visible');
    setPhase(2);
    updateProgress(1, trReplace('msg.translating_n', {N: 0, M: _translateAllTotal}));
    const langList = langs.map(langDisplayName).join(' · ');
    const seed = [
      'RETRANSLATION ENGINE INITIALIZED',
      `Target Languages  : ${langList}`,
      `Entries Queued    : ${_translateAllTotal}`,
      'Mode              : Full-corpus semantic rewrite',
      'Prior translations cleared — awaiting LLM stream…',
    ].join('\n');
    sciReset('p2', seed);
  }
  _updateTranslateProgress();

  try {
    const r = await fetch('/api/translate_all', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({translate_to: langs, replace: true})
    });
    const js = await r.json().catch(() => ({}));
    if (!r.ok || js.error) throw new Error(js.error || ('HTTP ' + r.status));
    if (typeof js.count === 'number') {
      _translateAllTotal = js.count;
      _translateAllRunning = js.count > 0;
      _updateTranslateProgress();
      if (js.count === 0) {
        const tst = document.getElementById('TST');
        if (tst) tst.textContent = tr('msg.translate_done');
      }
    }
  } catch (err) {
    _translateAllRunning = false;
    _retranslateVisualRunning = false;
    updateProgress(0, tr('msg.retranslate_failed'));
    sciFinishThen(() => {
      document.getElementById('PROG').classList.remove('visible');
      document.getElementById('EXPORT_BAR').classList.add('visible');
      document.getElementById('SUB_WRAP').classList.add('visible');
    });
    _updateTranslateProgress();
    alert(tr('msg.retranslate_failed') + ': ' + (err && err.message ? err.message : err));
  } finally {
    _syncRetranslateButton();
  }
}

let _translateAllRunning = false;
let _translateAllTotal   = 0;
let _translateAllDone    = 0;
let _retranslateVisualRunning = false;
let _translateAllCompletedIds = new Set();

function _syncRetranslateButton() {
  const btn = document.getElementById('BTN_RETRANSLATE_ALL');
  if (!btn) return;
  btn.disabled = !!_translateAllRunning;
  btn.textContent = (_translateAllRunning ? '↻ ' + tr('panel.retranslate_running') : '↻ ' + tr('panel.retranslate_all'));
  btn.title = tr('panel.retranslate_title');
}

function _updateTranslateProgress() {
  _translateAllDone = _translateAllCompletedIds.size;
  const tst = document.getElementById('TST');
  if (!_translateAllRunning) {
    // 恢复 TST 为 worker 状态
    if (tst && tst.dataset.translating) {
      tst.textContent = tr('topbar.ready');
      delete tst.dataset.translating;
    }
    _syncRetranslateButton();
    return;
  }

  const label = trReplace('msg.translating_n', {N: _translateAllDone, M: _translateAllTotal});
  if (tst) {
    tst.dataset.translating = '1';
    tst.textContent = label;
  }
  if (_retranslateVisualRunning) {
    const pct = _translateAllTotal ? Math.max(3, Math.min(99, Math.round((_translateAllDone / _translateAllTotal) * 100))) : 3;
    updateProgress(pct, label);
    sciShow('p2');
  }

  if (_translateAllTotal > 0 && _translateAllDone >= _translateAllTotal) {
    _translateAllRunning = false;
    _translateAllDone    = 0;
    if (tst) { tst.textContent = tr('msg.translate_done'); delete tst.dataset.translating; }
    if (_retranslateVisualRunning) {
      _retranslateVisualRunning = false;
      updateProgress(100, tr('msg.translate_done'));
      sciAppend('Translation stream complete. Rebuilding subtitle cards...', 'p2');
      sciFinishThen(() => showReview(_entries));
    }
    // 两秒后恢复就绪状态
    setTimeout(() => {
      const t = document.getElementById('TST');
      if (t && !t.dataset.translating) t.textContent = tr('topbar.ready');
    }, 2000);
  }
  _syncRetranslateButton();
}

function applyTranslation(entry_id, trans, msg=null) {
  if (entry_id == null) return;
  const eidNum = Number(entry_id);
  // 重新翻译时无条件计入，避免 _translateAllRunning 被 translate_started 短暂重置时漏计
  if (_retranslateVisualRunning || _translateAllRunning) _translateAllCompletedIds.add(eidNum);
  if (!_entries[entry_id]) { _updateTranslateProgress(); return; }
  _entries[entry_id].translations = trans || {};
  // If automatic post-LLM translation arrives before the review cards have
  // been rendered, do not leave the user stuck in the Phase II preview.
  const subWrap = document.getElementById('SUB_WRAP');
  if (!_retranslateVisualRunning && subWrap && !subWrap.classList.contains('visible') && Array.isArray(_entries) && _entries.length) {
    sciFinishThen(() => showReview(_entries));
  }
  // During full retranslation, mirror every backend translate_done event into the
  // sci-fi panel. This no longer depends on whether parsed translations are
  // non-empty, so JSON repair/fallback cases still visibly advance.
  if (_retranslateVisualRunning || _translateAllRunning) {
    const total = _translateAllTotal || _entries.length || 0;
    const head = `[${Number(entry_id)+1}/${total}] ` + ((msg && msg.preview_log) ? msg.preview_log : 'LLM TRANSLATE completed');
    let body = (msg && msg.preview_text) ? String(msg.preview_text) : '';
    if (!body) {
      const base = _entries[entry_id].corrected || _entries[entry_id].text || '';
      const lines = Object.entries(trans || {}).map(([l,t]) => `${langDisplayName(l)}: ${t}`).join('\n');
      const marker = lines ? lines : '[' + tr('msg.translate_done') + ' / no parsed translation]';
      body = `${base}${marker ? '\n' + marker : ''}`;
    }
    sciShow('p2');
    sciAppend(`${head}${body ? '\n' + body : ''}`, 'p2');
  }
  const el = document.querySelector(`.entry[data-idx="${entry_id}"]`);
  if (!el) { _updateTranslateProgress(); return; }
  const textEl = el.querySelector('.entry-text');
  if (textEl) textEl.style.opacity = '';

  let td = el.querySelector('.entry-trans');
  if (!td) {
    td = document.createElement('div');
    td.className = 'entry-trans';
    const actions = el.querySelector('.entry-actions');
    if (actions) el.insertBefore(td, actions); else el.appendChild(td);
  }
  td.innerHTML = Object.entries(trans || {}).map(([l,t]) =>
    `<div class="trans-line">${langTag(l)}${esc(t)}</div>`
  ).join('');
  _updateTranslateProgress();
}

// ── Settings ──────────────────────────────────────────────────
function applySettings(s) {
  _settings = s;
  const set = (id, v) => { const el=document.getElementById(id); if(el) el.value=v||''; };
  set('SEL_LANG',    s.asr_language||'');
  set('CTX_PROMPT',  s.context_prompt||'');
  // translate chips
  const active = new Set(s.translate_to||[]);
  document.querySelectorAll('.lang-chip').forEach(c =>
    c.classList.toggle('on', active.has(c.dataset.lang)));
  // diarize settings
  const dEnabled = !!s.diarize_enabled;
  const dAuto    = s.diarize_auto !== false;
  const thr      = parseFloat(s.diarize_threshold ?? 0.05);
  const tgl = document.getElementById('TGL_DIARIZE');
  const tglA = document.getElementById('TGL_DIARIZE_AUTO');
  const opts = document.getElementById('DIARIZE_OPTS');
  const slider = document.getElementById('THR_SLIDER');
  const thrVal = document.getElementById('THR_VAL');
  if (tgl)   tgl.classList.toggle('on', dEnabled);
  if (tglA)  tglA.classList.toggle('on', dAuto);
  if (opts)  opts.style.display = dEnabled ? '' : 'none';
  if (slider) slider.value = thr;
  if (thrVal) thrVal.textContent = thr.toFixed(2);
  // Sync debug output toggle
  syncDebugOutputUI(s);
  if (document.getElementById('ADV_MASK')?.classList.contains('visible')) renderAdvancedSettings();
  updateSciModeButton();
}

async function loadModels() {
  const r = await fetch('/api/models');
  const m = await r.json();
  function fill(id, list, cur) {
    const el=document.getElementById(id); if(!el) return;
    el.innerHTML = list.length
      ? list.map(v=>`<option value="${v}" ${v===cur?'selected':''}>${v.split('/').pop()}</option>`).join('')
      : `<option value="">${tr('panel.no_models')}</option>`;
  }
  fill('SEL_WHISPER', m.whisper||[],     _settings.whisper_repo);
  fill('SEL_LLM',     m.llm||[],         _settings.llm_repo);
}

function saveSettings() {
  const active = [...document.querySelectorAll('.lang-chip.on')].map(c=>c.dataset.lang);
  const thr = parseFloat(document.getElementById('THR_SLIDER')?.value ?? 0.05);
  const s = {
    whisper_repo:       document.getElementById('SEL_WHISPER').value,
    llm_repo:           document.getElementById('SEL_LLM').value,
    asr_language:       document.getElementById('SEL_LANG').value || null,
    translate_to:       active,
    context_prompt:     document.getElementById('CTX_PROMPT').value,
    diarize_enabled:    document.getElementById('TGL_DIARIZE')?.classList.contains('on') || false,
    diarize_auto:       document.getElementById('TGL_DIARIZE_AUTO')?.classList.contains('on') !== false,
    diarize_threshold:  thr,
    debug_output:       _debugOutputEnabled,
    advanced_params:    Object.assign({}, _settings.advanced_params || {}),
    advanced_presets:   Array.isArray(_settings.advanced_presets) ? _settings.advanced_presets : [],
  };
  fetch('/api/settings', {method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(s)});
}


// ── Advanced ASR / LLM parameters ─────────────────────────────

const ADV_FALLBACK = {
  zh: {
    'adv.btn_title':'高级参数设置', 'adv.title':'高级 ASR / LLM 参数', 'adv.close':'关闭',
    'adv.intro':'这些参数来自当前版本中 ASR 和 LLM 流程原本写死的默认数值。建议先使用默认值；只有在识别空白、幻觉、分句过细、翻译截断或速度/质量需要权衡时再调整。',
    'adv.asr_section':'ASR 参数', 'adv.llm_section':'LLM 参数', 'adv.reset':'恢复默认值', 'adv.apply':'应用到设置', 'adv.save_close':'保存并关闭', 'adv.on':'开', 'adv.off':'关',
    'adv.preset_label':'参数预设', 'adv.preset_apply':'套用预设', 'adv.preset_save':'保存当前为预设', 'adv.preset_delete':'删除自定义预设',
    'adv.preset_help':'预设会覆盖当前高级参数框中的数值；套用后请点击“应用到设置”或“保存并关闭”使其生效。自定义预设会保存在本机设置文件中。',
    'adv.preset_group_builtin':'内置预设', 'adv.preset_group_custom':'自定义预设',
    'adv.preset_builtin_default':'默认 / 平衡', 'adv.preset_builtin_far_dull':'远距离 / 声音闷', 'adv.preset_builtin_noisy_strict':'噪声多 / 抑制幻觉', 'adv.preset_builtin_long_translate':'长句 / 多语种翻译', 'adv.preset_builtin_fast':'速度优先', 'adv.preset_builtin_accuracy':'质量优先',
    'adv.preset_prompt':'请输入预设名称：', 'adv.preset_name_empty':'预设名称不能为空。', 'adv.preset_replace_confirm':'已存在同名自定义预设，是否覆盖？', 'adv.preset_saved':'预设已保存。', 'adv.preset_select_custom':'请选择一个自定义预设。', 'adv.preset_delete_confirm':'确定删除该自定义预设吗？',
    'adv.asr_temperature.title':'ASR 随机性', 'adv.asr_temperature.help':'默认 0。越高越可能探索不同文本，但也更容易不稳定；法律/技术录音建议保持 0。',
    'adv.asr_condition_on_previous_text.title':'参考前文', 'adv.asr_condition_on_previous_text.help':'默认关闭。关闭可降低前文污染和重复幻觉；若长音频上下文连续性不足，可尝试开启。',
    'adv.asr_no_speech_threshold.title':'无语音阈值', 'adv.asr_no_speech_threshold.help':'默认 0.45。越高越不容易把片段判为空白；空白太多可升高，噪音被识别成文字可降低。',
    'adv.asr_compression_ratio_threshold.title':'压缩率过滤阈值', 'adv.asr_compression_ratio_threshold.help':'默认 1.8。用于过滤异常重复/压缩文本；重复幻觉多时可适当降低，漏识别时可适当升高。',
    'adv.asr_logprob_threshold.title':'置信度过滤阈值', 'adv.asr_logprob_threshold.help':'默认 -1.0。越高越严格；误识别噪音多可升高，漏字多可降低。',
    'adv.asr_fp16.title':'FP16 推理', 'adv.asr_fp16.help':'默认开启。通常更快、更省内存；如遇模型/设备兼容问题可关闭。',
    'adv.llm_temperature.title':'LLM 随机性', 'adv.llm_temperature.help':'默认 0。越高表达越发散，但纠错/翻译稳定性下降；建议保持 0。',
    'adv.llm_context_prompt_max_chars.title':'提示词截取长度', 'adv.llm_context_prompt_max_chars.help':'默认 300 字。增加可提供更多术语背景，但会占用上下文并略降速度。',
    'adv.llm_phase1_chunk_max_chars.title':'Phase 1 分块长度', 'adv.llm_phase1_chunk_max_chars.help':'默认 350 字。越大上下文更完整但更慢、更易超长；越小更稳但可能割裂语义。',
    'adv.llm_phase1_max_tokens.title':'Phase 1 最大输出', 'adv.llm_phase1_max_tokens.help':'默认 1200。Phase 1 输出被截断时可增大；过大可能降低速度。',
    'adv.llm_phase1_min_length_ratio.title':'Phase 1 最短比例保护', 'adv.llm_phase1_min_length_ratio.help':'默认 0.5。LLM 输出短于原 chunk 该比例时回退 ASR 原文；可防止过度删减。',
    'adv.llm_phase2_base_max_tokens.title':'Phase 2 基础输出', 'adv.llm_phase2_base_max_tokens.help':'默认 1200。控制单句最终纠错的基础输出上限；长句被截断时可增大。',
    'adv.llm_phase2_tokens_per_target_lang.title':'Phase 2 每种翻译增量', 'adv.llm_phase2_tokens_per_target_lang.help':'默认 600。同步翻译目标语言越多，需要越高；翻译截断时可增大。',
    'adv.llm_translate_base_tokens.title':'单句翻译基础输出', 'adv.llm_translate_base_tokens.help':'默认 800。用于手动/批量翻译单条字幕的基础 token 预算。',
    'adv.llm_translate_tokens_per_target_lang.title':'单句翻译每语种增量', 'adv.llm_translate_tokens_per_target_lang.help':'默认 350。目标语种越多越需要增大；过大则速度变慢。',
    'adv.llm_translate_max_tokens_cap.title':'单句翻译输出上限', 'adv.llm_translate_max_tokens_cap.help':'默认 2400。是单句翻译 token 预算的封顶值，避免多语种翻译失控。'
  },
  en: {
    'adv.btn_title':'Advanced parameter settings', 'adv.title':'Advanced ASR / LLM Parameters', 'adv.close':'Close',
    'adv.intro':'These parameters are the hard-coded ASR and LLM defaults used by this version. Keep the defaults first; adjust them only when you see blank recognition, hallucination, over-fragmented sentences, truncated translations, or a speed/quality trade-off.',
    'adv.asr_section':'ASR parameters', 'adv.llm_section':'LLM parameters', 'adv.reset':'Restore defaults', 'adv.apply':'Apply to settings', 'adv.save_close':'Save and close', 'adv.on':'On', 'adv.off':'Off',
    'adv.preset_label':'Presets', 'adv.preset_apply':'Apply preset', 'adv.preset_save':'Save current as preset', 'adv.preset_delete':'Delete custom preset',
    'adv.preset_help':'A preset will overwrite the values currently shown in the advanced parameter fields. After applying one, click “Apply to settings” or “Save and close” to make it effective. Custom presets are saved in the local settings file.',
    'adv.preset_group_builtin':'Built-in presets', 'adv.preset_group_custom':'Custom presets',
    'adv.preset_builtin_default':'Default / balanced', 'adv.preset_builtin_far_dull':'Distant / muffled recording', 'adv.preset_builtin_noisy_strict':'Noisy / hallucination control', 'adv.preset_builtin_long_translate':'Long sentences / multilingual translation', 'adv.preset_builtin_fast':'Speed first', 'adv.preset_builtin_accuracy':'Quality first',
    'adv.preset_prompt':'Enter a preset name:', 'adv.preset_name_empty':'Preset name cannot be empty.', 'adv.preset_replace_confirm':'A custom preset with the same name already exists. Replace it?', 'adv.preset_saved':'Preset saved.', 'adv.preset_select_custom':'Please select a custom preset.', 'adv.preset_delete_confirm':'Delete this custom preset?',
    'adv.asr_temperature.title':'ASR temperature', 'adv.asr_temperature.help':'Default 0. Higher values may explore alternatives but are less stable; keep 0 for legal/technical recordings.',
    'adv.asr_condition_on_previous_text.title':'Condition on previous text', 'adv.asr_condition_on_previous_text.help':'Default off. Turning it off reduces previous-text contamination and repetition; turn it on if long-audio continuity is insufficient.',
    'adv.asr_no_speech_threshold.title':'No-speech threshold', 'adv.asr_no_speech_threshold.help':'Default 0.45. Higher values make blanks less likely; increase for too many blanks, lower if noise becomes text.',
    'adv.asr_compression_ratio_threshold.title':'Compression-ratio threshold', 'adv.asr_compression_ratio_threshold.help':'Default 1.8. Filters abnormal repeated/compressed output; lower it if repeated hallucinations occur, raise it if speech is dropped.',
    'adv.asr_logprob_threshold.title':'Log-probability threshold', 'adv.asr_logprob_threshold.help':'Default -1.0. Higher is stricter; raise it for noisy false text, lower it if real speech is dropped.',
    'adv.asr_fp16.title':'FP16 inference', 'adv.asr_fp16.help':'Default on. Usually faster and lighter; turn off only for model/device compatibility issues.',
    'adv.llm_temperature.title':'LLM temperature', 'adv.llm_temperature.help':'Default 0. Higher values are more creative but less stable for correction/translation; 0 is recommended.',
    'adv.llm_context_prompt_max_chars.title':'Context prompt length', 'adv.llm_context_prompt_max_chars.help':'Default 300 chars. More context can help terminology but consumes context and may slow processing.',
    'adv.llm_phase1_chunk_max_chars.title':'Phase 1 chunk length', 'adv.llm_phase1_chunk_max_chars.help':'Default 350 chars. Larger chunks preserve context but are slower and risk long outputs; smaller chunks are steadier but may split meaning.',
    'adv.llm_phase1_max_tokens.title':'Phase 1 max output', 'adv.llm_phase1_max_tokens.help':'Default 1200. Increase if Phase 1 output is truncated; larger values may slow processing.',
    'adv.llm_phase1_min_length_ratio.title':'Phase 1 minimum-length guard', 'adv.llm_phase1_min_length_ratio.help':'Default 0.5. If LLM output is shorter than this ratio of the original chunk, the app falls back to ASR text to avoid over-deletion.',
    'adv.llm_phase2_base_max_tokens.title':'Phase 2 base output', 'adv.llm_phase2_base_max_tokens.help':'Default 1200. Base token budget for final sentence correction; increase for truncated long sentences.',
    'adv.llm_phase2_tokens_per_target_lang.title':'Phase 2 tokens per target language', 'adv.llm_phase2_tokens_per_target_lang.help':'Default 600. More target languages need a larger budget; increase if synchronized translations are truncated.',
    'adv.llm_translate_base_tokens.title':'Single-entry translation base output', 'adv.llm_translate_base_tokens.help':'Default 800. Base token budget for manual/batch translation of one subtitle entry.',
    'adv.llm_translate_tokens_per_target_lang.title':'Single-entry tokens per target language', 'adv.llm_translate_tokens_per_target_lang.help':'Default 350. More target languages need a larger budget; too large will slow processing.',
    'adv.llm_translate_max_tokens_cap.title':'Single-entry translation cap', 'adv.llm_translate_max_tokens_cap.help':'Default 2400. Caps the translation token budget to prevent runaway multi-language output.'
  }
};
function advLang() { return (window.I18N && window.I18N.getLang && window.I18N.getLang() === 'en') ? 'en' : 'zh'; }
function advT(key) {
  const viaI18n = tr(key);
  if (viaI18n && viaI18n !== key) return viaI18n;
  return (ADV_FALLBACK[advLang()] && ADV_FALLBACK[advLang()][key]) || ADV_FALLBACK.zh[key] || key;
}
function updateAdvancedStaticTexts() {
  const setText = (sel, key) => { const el = document.querySelector(sel); if (el) el.textContent = advT(key); };
  setText('.adv-title', 'adv.title');
  setText('.adv-intro', 'adv.intro');
  setText('[data-i18n="adv.asr_section"]', 'adv.asr_section');
  setText('[data-i18n="adv.llm_section"]', 'adv.llm_section');
  setText('[data-i18n="adv.close"]', 'adv.close');
  setText('[data-i18n="adv.reset"]', 'adv.reset');
  setText('[data-i18n="adv.apply"]', 'adv.apply');
  setText('[data-i18n="adv.save_close"]', 'adv.save_close');
  setText('[data-i18n="adv.preset_label"]', 'adv.preset_label');
  setText('[data-i18n="adv.preset_apply"]', 'adv.preset_apply');
  setText('[data-i18n="adv.preset_save"]', 'adv.preset_save');
  setText('[data-i18n="adv.preset_delete"]', 'adv.preset_delete');
  setText('[data-i18n="adv.preset_help"]', 'adv.preset_help');
  const advBtn = document.getElementById('BTN_ADV');
  if (advBtn) advBtn.title = advT('adv.btn_title');
}

const ADV_META = [
  {key:'asr_temperature', group:'asr', type:'number', min:0, max:1, step:0.05},
  {key:'asr_condition_on_previous_text', group:'asr', type:'bool'},
  {key:'asr_no_speech_threshold', group:'asr', type:'number', min:0, max:1, step:0.05},
  {key:'asr_compression_ratio_threshold', group:'asr', type:'number', min:0, max:10, step:0.1},
  {key:'asr_logprob_threshold', group:'asr', type:'number', min:-5, max:1, step:0.1},
  {key:'asr_fp16', group:'asr', type:'bool'},
  {key:'llm_temperature', group:'llm', type:'number', min:0, max:1.5, step:0.05},
  {key:'llm_context_prompt_max_chars', group:'llm', type:'number', min:0, max:2000, step:50},
  {key:'llm_phase1_chunk_max_chars', group:'llm', type:'number', min:80, max:2000, step:10},
  {key:'llm_phase1_max_tokens', group:'llm', type:'number', min:128, max:8192, step:64},
  {key:'llm_phase1_min_length_ratio', group:'llm', type:'number', min:0.1, max:1, step:0.05},
  {key:'llm_phase2_base_max_tokens', group:'llm', type:'number', min:128, max:8192, step:64},
  {key:'llm_phase2_tokens_per_target_lang', group:'llm', type:'number', min:0, max:4096, step:64},
  {key:'llm_translate_base_tokens', group:'llm', type:'number', min:128, max:8192, step:64},
  {key:'llm_translate_tokens_per_target_lang', group:'llm', type:'number', min:0, max:4096, step:64},
  {key:'llm_translate_max_tokens_cap', group:'llm', type:'number', min:256, max:16384, step:128},
];

function advBuiltInPresets() {
  const d = advDefaults();
  const merge = (patch) => Object.assign({}, d, patch || {});
  return [
    {id:'default', labelKey:'adv.preset_builtin_default', params:merge({})},
    {id:'far_dull', labelKey:'adv.preset_builtin_far_dull', params:merge({
      asr_condition_on_previous_text:false,
      asr_no_speech_threshold:0.35,
      asr_compression_ratio_threshold:2.0,
      asr_logprob_threshold:-1.2,
      asr_temperature:0.0,
    })},
    {id:'noisy_strict', labelKey:'adv.preset_builtin_noisy_strict', params:merge({
      asr_condition_on_previous_text:false,
      asr_no_speech_threshold:0.55,
      asr_compression_ratio_threshold:1.6,
      asr_logprob_threshold:-0.8,
      asr_temperature:0.0,
    })},
    {id:'long_translate', labelKey:'adv.preset_builtin_long_translate', params:merge({
      llm_context_prompt_max_chars:500,
      llm_phase1_chunk_max_chars:420,
      llm_phase1_max_tokens:1600,
      llm_phase2_base_max_tokens:1600,
      llm_phase2_tokens_per_target_lang:900,
      llm_translate_base_tokens:1000,
      llm_translate_tokens_per_target_lang:550,
      llm_translate_max_tokens_cap:4096,
    })},
    {id:'fast', labelKey:'adv.preset_builtin_fast', params:merge({
      llm_context_prompt_max_chars:200,
      llm_phase1_chunk_max_chars:300,
      llm_phase1_max_tokens:800,
      llm_phase2_base_max_tokens:900,
      llm_phase2_tokens_per_target_lang:400,
      llm_translate_base_tokens:600,
      llm_translate_tokens_per_target_lang:250,
      llm_translate_max_tokens_cap:1800,
    })},
    {id:'accuracy', labelKey:'adv.preset_builtin_accuracy', params:merge({
      llm_context_prompt_max_chars:600,
      llm_phase1_chunk_max_chars:450,
      llm_phase1_max_tokens:1800,
      llm_phase2_base_max_tokens:1800,
      llm_phase2_tokens_per_target_lang:800,
      llm_translate_base_tokens:1000,
      llm_translate_tokens_per_target_lang:450,
      llm_translate_max_tokens_cap:3600,
    })},
  ];
}
function advCustomPresets() {
  return Array.isArray(_settings.advanced_presets) ? _settings.advanced_presets : [];
}
function renderAdvancedPresetControls() {
  const sel = document.getElementById('ADV_PRESET_SELECT');
  if (!sel) return;
  const keep = sel.value;
  const built = advBuiltInPresets().map(p => `<option value="builtin:${esc(p.id)}">${esc(advT(p.labelKey))}</option>`).join('');
  const customList = advCustomPresets().map(p => `<option value="custom:${esc(p.id)}">${esc(p.name || p.id)}</option>`).join('');
  sel.innerHTML = `<optgroup label="${esc(advT('adv.preset_group_builtin'))}">${built}</optgroup>` +
    (customList ? `<optgroup label="${esc(advT('adv.preset_group_custom'))}">${customList}</optgroup>` : '');
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
}
function getSelectedAdvancedPreset() {
  const val = document.getElementById('ADV_PRESET_SELECT')?.value || 'builtin:default';
  const [kind, id] = val.split(':');
  if (kind === 'custom') return {kind, preset: advCustomPresets().find(p => p.id === id)};
  return {kind:'builtin', preset: advBuiltInPresets().find(p => p.id === id)};
}
function applyAdvancedPreset() {
  const {preset} = getSelectedAdvancedPreset();
  if (!preset || !preset.params) return;
  _settings.advanced_params = Object.assign({}, advDefaults(), preset.params);
  renderAdvancedSettings(_settings.advanced_params);
}
function saveAdvancedPreset() {
  const name = (prompt(advT('adv.preset_prompt'), '') || '').trim();
  if (!name) { alert(advT('adv.preset_name_empty')); return; }
  const params = collectAdvancedSettings();
  const list = advCustomPresets().slice();
  const existing = list.findIndex(p => String(p.name || '').trim() === name);
  if (existing >= 0 && !confirm(advT('adv.preset_replace_confirm'))) return;
  const item = {id: existing >= 0 ? list[existing].id : ('custom_' + Date.now()), name, params, updated_at: new Date().toISOString()};
  if (existing >= 0) list[existing] = item; else list.push(item);
  _settings.advanced_presets = list;
  _settings.advanced_params = params;
  saveSettings();
  renderAdvancedPresetControls();
  const sel = document.getElementById('ADV_PRESET_SELECT');
  if (sel) sel.value = 'custom:' + item.id;
  alert(advT('adv.preset_saved'));
}
function deleteAdvancedPreset() {
  const val = document.getElementById('ADV_PRESET_SELECT')?.value || '';
  if (!val.startsWith('custom:')) { alert(advT('adv.preset_select_custom')); return; }
  const id = val.slice('custom:'.length);
  if (!confirm(advT('adv.preset_delete_confirm'))) return;
  _settings.advanced_presets = advCustomPresets().filter(p => p.id !== id);
  saveSettings();
  renderAdvancedPresetControls();
}

async function loadDefaultSettings() {
  if (_defaultSettings && _defaultSettings.advanced_params) return _defaultSettings;
  try {
    const r = await fetch('/api/settings_defaults');
    _defaultSettings = await r.json();
  } catch(e) {
    _defaultSettings = {advanced_params: {}};
  }
  return _defaultSettings;
}
function advDefaults() { return (_defaultSettings && _defaultSettings.advanced_params) || {}; }
function advCurrent() { return Object.assign({}, advDefaults(), (_settings && _settings.advanced_params) || {}); }
function advTitle(k) { return advT('adv.' + k + '.title'); }
function advHelp(k) { return advT('adv.' + k + '.help'); }
function renderAdvancedSettings(values) {
  updateAdvancedStaticTexts();
  const cur = values || advCurrent();
  const render = (group, targetId) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = ADV_META.filter(m => m.group === group).map(m => {
      const v = cur[m.key];
      let input = '';
      if (m.type === 'bool') {
        input = `<select class="adv-input" id="ADV_${m.key}"><option value="true" ${v ? 'selected' : ''}>${tr('adv.on')}</option><option value="false" ${!v ? 'selected' : ''}>${tr('adv.off')}</option></select>`;
      } else {
        input = `<input class="adv-input" id="ADV_${m.key}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" data-min="${m.min}" data-max="${m.max}" data-step="${m.step}" value="${esc(v ?? advDefaults()[m.key] ?? '')}">`;
      }
      return `<div class="adv-card">
        <div class="adv-row"><div style="min-width:0"><div class="adv-name">${esc(advTitle(m.key))}</div><div class="adv-key">${esc(m.key)}</div></div>${input}</div>
        <div class="adv-help">${esc(advHelp(m.key))}</div>
      </div>`;
    }).join('');
  };
  render('asr', 'ADV_ASR_GRID');
  render('llm', 'ADV_LLM_GRID');
  renderAdvancedPresetControls();
}
async function openAdvancedSettings() {
  updateAdvancedStaticTexts();
  // Show the modal immediately. Do not make the button feel unresponsive
  // if /api/settings_defaults is slow or temporarily unavailable.
  const mask = document.getElementById('ADV_MASK');
  if (mask) mask.classList.add('visible');
  renderAdvancedSettings(advCurrent());
  try {
    await loadDefaultSettings();
    renderAdvancedSettings(advCurrent());
  } catch(e) {
    console.warn('[AdvancedSettings] failed to load defaults:', e);
  }
}
function closeAdvancedSettings() {
  const mask = document.getElementById('ADV_MASK');
  if (mask) mask.classList.remove('visible');
}
function collectAdvancedSettings() {
  const out = {};
  for (const m of ADV_META) {
    const el = document.getElementById('ADV_' + m.key);
    if (!el) continue;
    if (m.type === 'bool') out[m.key] = (el.value === 'true');
    else {
      let v = parseFloat(el.value);
      if (!Number.isFinite(v)) v = advDefaults()[m.key];
      if (Number.isFinite(m.min) && v < m.min) v = m.min;
      if (Number.isFinite(m.max) && v > m.max) v = m.max;
      out[m.key] = v;
      el.value = v;
    }
  }
  return out;
}
function saveAdvancedSettingsFromModal() {
  _settings.advanced_params = collectAdvancedSettings();
  saveSettings();
}
function saveAdvancedSettingsAndClose() {
  saveAdvancedSettingsFromModal();
  closeAdvancedSettings();
}
async function resetAdvancedSettingsToDefault() {
  await loadDefaultSettings();
  _settings.advanced_params = Object.assign({}, advDefaults());
  renderAdvancedSettings(_settings.advanced_params);
  saveSettings();
}

// ── Speaker Diarization ───────────────────────────────────────
function toggleDiarize() {
  const tgl  = document.getElementById('TGL_DIARIZE');
  const opts = document.getElementById('DIARIZE_OPTS');
  if (!tgl) return;
  tgl.classList.toggle('on');
  const on = tgl.classList.contains('on');
  if (opts) opts.style.display = on ? '' : 'none';
}

function toggleDiarizeAuto() {
  const tgl = document.getElementById('TGL_DIARIZE_AUTO');
  if (tgl) tgl.classList.toggle('on');
}

function onThrSlider(val) {
  const v = parseFloat(val).toFixed(2);
  const el = document.getElementById('THR_VAL');
  if (el) el.textContent = v;
}

async function runDiarize(reclusterOnly) {
  if (!_entries.length) { alert(tr('msg.alert_need_correct')); return; }
  const thr = parseFloat(document.getElementById('THR_SLIDER')?.value ?? 0.35);
  const bd = document.getElementById('BTN_DIARIZE');
  const br = document.getElementById('BTN_RECLUSTER');
  if (bd) { bd.disabled = true; bd.textContent = tr('panel.diarize_running'); }
  if (br) { br.disabled = true; br.textContent = tr('panel.diarize_clustering'); }
  setPhase(3);
  updateProgress(5, reclusterOnly ? tr('msg.recluster_running') : tr('msg.embed_extracting'));
  const r = await fetch('/api/diarize', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({threshold: thr, recluster_only: reclusterOnly}),
  });
  if (!r.ok) {
    const body = await r.json().catch(()=>({}));
    alert(tr('msg.diarize_failed') + (body.error || r.status));
    if (bd) { bd.disabled = false; bd.textContent = tr('panel.diarize_redo'); }
    if (br) { br.disabled = false; br.textContent = tr('panel.diarize_recluster'); }
  }
  // Result arrives via WebSocket diarize_done
}

function updateSpeakerPanel(entries) {
  const res  = document.getElementById('DIARIZE_RESULT');
  const sum  = document.getElementById('DIARIZE_SUMMARY');
  const list = document.getElementById('SPK_LIST');
  if (!res || !list) return;

  const counts = {};
  (entries || []).forEach(e => {
    if (e.speaker) counts[e.speaker] = (counts[e.speaker] || 0) + 1;
  });
  // Preserve speaker order. Do not sort by renamed display name.
  rememberSpeakerOrderFromEntries(entries, false);
  const speakers = (_speakerOrder || []).filter(spk => Object.prototype.hasOwnProperty.call(counts, spk));
  Object.keys(counts).forEach(spk => { if (!speakers.includes(spk)) speakers.push(spk); });
  updateSubtitleSpeakerOptions();
  if (!speakers.length) { res.style.display = 'none'; return; }

  res.style.display = '';
  if (sum) sum.textContent = trReplace('panel.diarize_count_n', {N: speakers.length});
  const _micS = '<svg class="svg-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;margin-right:2px;flex-shrink:0"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="21" x2="12" y2="17"/><line x1="8" y1="21" x2="16" y2="21"/></svg>';
  list.innerHTML = speakers.map(spk => `
    <div class="spk-list-row">
      <span class="spk-badge ${_speakerClass(spk)}"
            onclick="openSpkPopup(event,'${esc(spk)}')" title="${tr('spk.rename_tooltip')}">
        ${_micS}${esc(spk)}
      </span>
      <span class="spk-list-count">${counts[spk]} ${tr('panel.diarize_unit')}</span>
    </div>
  `).join('');
}

// ── Speaker rename popup ───────────────────────────────────────
function openSpkPopup(event, spkName) {
  event.stopPropagation();
  _spkPopupTarget = spkName;
  const popup = document.getElementById('SPK_POPUP');
  const input = document.getElementById('SPK_POPUP_INPUT');
  if (!popup || !input) return;
  input.value = spkName;
  // Position near click
  popup.style.display = 'block';
  const x = Math.min(event.clientX, window.innerWidth - 240);
  const y = Math.min(event.clientY + 8, window.innerHeight - 120);
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';
  setTimeout(() => { input.focus(); input.select(); }, 30);
}

function closeSpkPopup() {
  const popup = document.getElementById('SPK_POPUP');
  if (popup) popup.style.display = 'none';
  _spkPopupTarget = null;
}

async function commitSpkRename() {
  const input = document.getElementById('SPK_POPUP_INPUT');
  const newName = input ? input.value.trim() : '';
  if (!newName || !_spkPopupTarget) { closeSpkPopup(); return; }
  const oldName = _spkPopupTarget;
  closeSpkPopup();
  if (newName === oldName) return;

  // Optimistic local update
  applyRenameLocally(oldName, newName);

  // Persist on server
  await fetch('/api/diarize_rename', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({old_name: oldName, new_name: newName}),
  });
}

function applyRenameLocally(oldName, newName) {
  // Update _entries
  _entries.forEach(e => { if (e.speaker === oldName) e.speaker = newName; });
  // Preserve sidebar position and color when renaming.
  if (!_speakerColorMap || !Array.isArray(_speakerOrder)) resetSpeakerColorState();
  const oldIdx = _speakerOrder.indexOf(oldName);
  const newIdx = _speakerOrder.indexOf(newName);
  if (oldIdx >= 0) {
    if (newIdx >= 0 && newIdx !== oldIdx) {
      // Renaming into an existing speaker merges the entries; remove the old slot.
      _speakerOrder.splice(oldIdx, 1);
    } else {
      _speakerOrder[oldIdx] = newName;
    }
  } else if (newIdx < 0) {
    _speakerOrder.push(newName);
  }
  if (_speakerColorMap[oldName]) {
    _speakerColorMap[newName] = _speakerColorMap[oldName];
    delete _speakerColorMap[oldName];
  }
  // Re-render all badges
  const _micSvgR = '<svg class="svg-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;margin-right:2px;flex-shrink:0"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="21" x2="12" y2="17"/><line x1="8" y1="21" x2="16" y2="21"/></svg>';
  document.querySelectorAll('.spk-badge').forEach(badge => {
    const txt = badge.textContent.trim();
    if (txt === oldName || txt === `🎙 ${oldName}`) {
      badge.innerHTML = `${_micSvgR}${esc(newName)}`;
      badge.className = `spk-badge ${_speakerClass(newName)}`;
      badge.setAttribute('onclick', `event.stopPropagation();openSpkPopup(event,'${esc(newName)}')`);
    }
  });
  // Update speaker panel list
  updateSpeakerPanel(_entries);
}

// Close popup on outside click
document.addEventListener('click', (e) => {
  const popup = document.getElementById('SPK_POPUP');
  if (popup && popup.style.display !== 'none' && !popup.contains(e.target)) {
    closeSpkPopup();
  }
});
// Confirm on Enter
document.addEventListener('keydown', (e) => {
  const popup = document.getElementById('SPK_POPUP');
  if (popup && popup.style.display !== 'none') {
    if (e.key === 'Enter') { e.preventDefault(); commitSpkRename(); }
    if (e.key === 'Escape') { closeSpkPopup(); }
  }
});

// ── Debug output toggle ───────────────────────────────────────
const _DBG_BTN_SVG = `<svg class="svg-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
function toggleDebugOutput() {
  _debugOutputEnabled = !_debugOutputEnabled;
  _settings.debug_output = _debugOutputEnabled;
  const btn  = document.getElementById('BTN_DBG_OUTPUT');
  const hint = document.getElementById('DBG_OUTPUT_HINT');
  if (btn) {
    btn.innerHTML = `${_DBG_BTN_SVG} <span>${tr(_debugOutputEnabled ? 'dbg.btn_output_on' : 'dbg.btn_output_off')}</span>`;
    btn.style.borderColor = _debugOutputEnabled ? 'var(--ac)' : 'var(--b2)';
    btn.style.color       = _debugOutputEnabled ? 'var(--ac)' : 'var(--hi)';
  }
  if (hint) hint.style.display = _debugOutputEnabled ? '' : 'none';
  // Persist immediately
  fetch('/api/settings', {method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({debug_output: _debugOutputEnabled})});
}

// Sync debug output state from settings on load
function syncDebugOutputUI(s) {
  _debugOutputEnabled = !!s.debug_output;
  const btn  = document.getElementById('BTN_DBG_OUTPUT');
  const hint = document.getElementById('DBG_OUTPUT_HINT');
  if (btn) {
    btn.innerHTML = `${_DBG_BTN_SVG} <span>${tr(_debugOutputEnabled ? 'dbg.btn_output_on' : 'dbg.btn_output_off')}</span>`;
    btn.style.borderColor = _debugOutputEnabled ? 'var(--ac)' : 'var(--b2)';
    btn.style.color       = _debugOutputEnabled ? 'var(--ac)' : 'var(--hi)';
  }
  if (hint) hint.style.display = _debugOutputEnabled ? '' : 'none';
}

// ── Export menus ──────────────────────────────────────────────
function toggleExportMenu(id) {
  // Close all other menus first
  document.querySelectorAll('.export-menu').forEach(m => {
    if (m.id !== id) m.style.display = 'none';
  });
  const el = document.getElementById(id);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : 'flex';
  if (!open && id === 'MENU_SINGLE') renderSingleLangList();
}

function closeExportMenus() {
  document.querySelectorAll('.export-menu').forEach(m => m.style.display = 'none');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.export-menu') && !e.target.closest('.btn')) {
    closeExportMenus();
  }
});

function renderSingleLangList() {
  const container = document.getElementById('SINGLE_LANG_LIST');
  if (!container) return;

  // ── 语言归一化映射：translations 里的英文键名 → sidebar 中文名 ──
  // 确保列表不出现 zh/English/Japanese 和 中文/英文/日文 两份重复
  const EN_TO_CN = {
    'chinese':'中文','english':'英文','japanese':'日文','korean':'韩文',
    'french':'法文','german':'德文','spanish':'西班牙文',
    'zh':'中文','en':'英文','ja':'日文','ko':'韩文','fr':'法文','de':'德文','es':'西班牙文',
  };
  const normalize = l => EN_TO_CN[l.toLowerCase()] || l;

  // 1. sidebar 已勾选语言（中文名，保持顺序）
  const sidebarLangs = [...document.querySelectorAll('.lang-chip.on')].map(c => c.dataset.lang);

  // 2. entries 中原文语言（归一化后）
  const origSet = new Set(
    (_entries||[]).map(e => normalize(e.language||'')).filter(Boolean)
  );

  // 3. entries 中已有翻译语言（归一化后）
  const transSet = new Set();
  (_entries||[]).forEach(e => Object.keys(e.translations||{}).forEach(k => transSet.add(normalize(k))));

  // 合并：sidebar 顺序优先，再补充原文语言和翻译语言
  const langs = [...new Set([...sidebarLangs, ...origSet, ...transSet])];
  if (!langs.length) langs.push('中文','英文','日文');

  // 默认选中：仅在没有已选 或 已选不在列表时才重置（不随 sidebar 变化强制覆盖）
  if (!_selectedExportLang || !langs.includes(_selectedExportLang)) {
    _selectedExportLang = langs[0];
  }

  container.innerHTML = langs.map(l => `
    <div class="lang-radio ${_selectedExportLang === l ? 'sel' : ''}"
         style="${langColorVars(l)}" onclick="selectExportLang('${esc(l)}')">
      <span style="font-size:13px">${_selectedExportLang===l ? '●' : '○'}</span>
      <span class="lang-radio-dot"></span>
      ${esc(langDisplayName(l))}
    </div>
  `).join('');
}

function selectExportLang(lang) {
  _selectedExportLang = lang;
  renderSingleLangList();
}

function doExportSingle(fmt) {
  if (!_selectedExportLang) { alert(tr('export.choose_lang_first')); return; }
  doExport(fmt, _selectedExportLang);
  closeExportMenus();
}

// ── Export ────────────────────────────────────────────────────
async function doExport(fmt, lang='mixed') {
  const url = `/api/export?fmt=${fmt}&lang=${encodeURIComponent(lang)}`;
  const r = await fetch(url);
  let text, type='text/plain;charset=utf-8', ext=fmt;
  if (fmt === 'json') {
    text = JSON.stringify(await r.json(), null, 2);
    type = 'application/json;charset=utf-8';
  } else {
    text = await r.text();
  }
  const langSuffix = lang === 'mixed' ? 'mixed' : lang.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g,'_');
  const filename = `transcript_${langSuffix}.${ext}`;
  const desc = lang === 'mixed' ? tr('msg.subtitle_mixed') : tr('msg.subtitle_single').replace('X', langDisplayName(lang));
  await saveTextWithDialog(filename, text, type, desc);
}

async function saveSession() {
  // 从服务端获取最新的音频元信息，保存进 ASO
  let sourceAudio = {};
  try {
    const r = await fetch('/api/file_info');
    if (r.ok) sourceAudio = await r.json();
  } catch(e) {}

  const payload = {
    app:          'Lancer1911 ASR Offline',
    version:      '0.7b',
    saved_at:     new Date().toISOString(),
    source_audio: sourceAudio,   // 原始音频文件的元信息
    settings:     _settings || {},
    entries:      _entries  || [],
    debug:        buildDebugSnapshot(),  // ASR 原文、segments、时间戳对比等调试面板数据
  };
  const filename = `session_${new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}.aso`;
  await saveTextWithDialog(filename, JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8', tr('msg.aso_session'));
}

async function loadSession() {
  // pywebview 模式：通过 js_api 弹原生打开对话框
  if (window.pywebview && window.pywebview.api) {
    try {
      const result = await window.pywebview.api.open_file();
      if (!result || result.cancelled) return;
      if (!result.ok) { alert(tr('msg.alert_read_fail') + (result.error || tr('msg.unknown_error'))); return; }
      await _applySessionContent(result.content, result.path);
    } catch (e) {
      alert(tr('msg.alert_read_fail') + e.message);
    }
    return;
  }
  // 浏览器模式：使用文件选择框
  document.getElementById('ASO_FILE_INPUT').click();
}

async function onAsoFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const text = await file.text();
  await _applySessionContent(text, file.name);
}

/** 用户选择配对音频文件后上传到服务器，以支持 playback */
async function onAsoAudioSelected(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';
  const formData = new FormData();
  formData.append('file', file);
  updateProgress(30, tr('msg.audio_loading'));
  try {
    const r = await fetch('/api/pair_audio', { method: 'POST', body: formData });
    if (!r.ok) { console.warn('音频上传失败', r.status); return; }
    // pair_audio succeeded; audio is now available via /api/audio; entries remain unchanged
    if (!_audioLoaded) {
      initPlayer(null);
      updateProgress(100, tr('msg.audio_paired'));
    }
  } catch(e) { console.warn('音频加载失败', e); }
}

async function _applySessionContent(jsonText, _sourcePath) {
  let payload;
  try { payload = JSON.parse(jsonText); }
  catch (e) { alert(tr('msg.alert_parse_aso')); return; }
  const r = await fetch('/api/load_session', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({content: jsonText, aso_path: _sourcePath || ''}),
  });
  if (!r.ok) {
    const j = await r.json().catch(()=>({}));
    alert(tr('msg.alert_load_fail') + (j.error || r.status));
  }
  // session_loaded WS 事件会更新 UI
}

// ── Save-to-disk: pywebview js_api → browser fallback ─────────
let _hasDialog = null;  // 缓存检测结果

async function _checkHasDialog() {
  if (_hasDialog !== null) return _hasDialog;
  // 优先检测 pywebview js_api（最可靠）
  _hasDialog = !!(window.pywebview && window.pywebview.api);
  return _hasDialog;
}

/**
 * 弹出文件保存对话框：
 * - pywebview：通过 window.pywebview.api.save_file() 弹原生系统对话框
 * - 纯浏览器：showSaveFilePicker → <a download> 降级
 */
async function saveTextWithDialog(suggestedName, text, mimeType='text/plain;charset=utf-8', description='文件') {
  // pywebview js_api 路径（最可靠，原生系统对话框）
  if (window.pywebview && window.pywebview.api) {
    try {
      const result = await window.pywebview.api.save_file(suggestedName, text);
      if (!result) return;
      if (result.cancelled) return;
      if (!result.ok) {
        console.warn('save_file error:', result.error);
        downloadText(suggestedName, text, mimeType);
      }
      return;
    } catch (e) {
      console.warn('pywebview.api.save_file error:', e);
      downloadText(suggestedName, text, mimeType);
      return;
    }
  }

  // 纯浏览器：showSaveFilePicker
  if (window.showSaveFilePicker) {
    try {
      const ext = suggestedName.split('.').pop().toLowerCase();
      const mimeMap = {
        srt:  ['text/plain',       '.srt'],
        txt:  ['text/plain',       '.txt'],
        md:   ['text/markdown',    '.md'],
        json: ['application/json', '.json'],
        aso:  ['application/json', '.aso'],
      };
      const [acceptMime, acceptExt] = mimeMap[ext] || ['text/plain', '.' + ext];
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { [acceptMime]: [acceptExt] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text], {type: mimeType}));
      await writable.close();
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('showSaveFilePicker failed, falling back:', err);
    }
  }
  downloadText(suggestedName, text, mimeType);
}

function downloadText(filename, text, type='text/plain;charset=utf-8') {
  const blob = new Blob([text], {type});
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {href:url, download:filename});
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function resetStartButton(disabled=true) {
  const btn = document.getElementById('BTN_START');
  if (btn) { btn.textContent = tr('fc.btn_start'); btn.disabled = !!disabled; }
}

// ── UI helpers ────────────────────────────────────────────────
function loadNew() {
  stopJobPolling();
  if (_progHideTimer) { clearTimeout(_progHideTimer); _progHideTimer = null; }
  fetch('/api/new_session', {method:'POST'}).catch(()=>{});

  _entries = [];
  resetSpeakerColorState();
  _spkPopupTarget = null;
  _selectedExportLang = null;
  _pendingAudioFilename = null;
  _translateAllRunning = false;
  _translateAllTotal = 0;
  _translateAllDone = 0;
  clearDebugPanelUI();
  sciHideNow();
  closeExportMenus();
  closeSpkPopup();

  const subWrap = document.getElementById('SUB_WRAP');
  if (subWrap) { subWrap.innerHTML=''; subWrap.classList.remove('visible'); }
  document.getElementById('EXPORT_BAR').classList.remove('visible');
  document.getElementById('DROP_OUTER').style.display='';
  document.getElementById('DROP').style.display='';
  document.getElementById('FILE_CARD').classList.remove('visible');
  document.getElementById('PROG').classList.remove('visible');
  document.getElementById('BTN_NEW').style.display='none';
  const btnSave = document.getElementById('BTN_SAVE');
  if (btnSave) btnSave.style.display='none';
  document.getElementById('FILE_INPUT').value='';
  const asoAudioInput = document.getElementById('ASO_AUDIO_INPUT');
  if (asoAudioInput) asoAudioInput.value = '';
  resetStartButton(true);

  // Reset speaker/diarization sidebar
  const diarizeResult = document.getElementById('DIARIZE_RESULT');
  const diarizeSummary = document.getElementById('DIARIZE_SUMMARY');
  const spkList = document.getElementById('SPK_LIST');
  if (diarizeResult) diarizeResult.style.display = 'none';
  if (diarizeSummary) diarizeSummary.textContent = '';
  if (spkList) spkList.innerHTML = '';

  // Reset player
  if (_audioEl) { _audioEl.pause(); _audioEl.src=''; }
  if (_audioBlob) { URL.revokeObjectURL(_audioBlob); _audioBlob=null; }
  _audioLoaded = false;
  document.getElementById('PLAYER').classList.remove('visible');
  document.getElementById('PLAY_BTN').textContent = '▶';
  document.getElementById('PLAY_TIME').textContent = '0:00 / 0:00';
  document.getElementById('SEEK_FILL').style.width = '0%';
  document.getElementById('SEEK_THUMB').style.left = '0%';
  const fsw=document.getElementById('FOLLOW_SW'); if(fsw){fsw.checked=true; _followMode=true;}
  const vb=document.getElementById('VOL_BTN'); if(vb) vb.innerHTML=ICON_VOL;
  setPhase(0);
  const tst = document.getElementById('TST');
  if (tst && _ready) tst.textContent = tr('topbar.ready');
}

function cancelJob() {
  const btn = document.getElementById('BTN_CANCEL');
  if (btn) { btn.disabled = true; btn.textContent = tr('prog.cancelling'); }
  document.getElementById('PROG_LBL').textContent = tr('prog.cancel_reload');
  // /api/cancel 重启 worker 子进程，真正中断 ASR/LLM 推理
  fetch('/api/cancel', {method:'POST'})
    .then(() => { if (ws) ws.send(JSON.stringify({act:'cancel'})); })
    .catch(() => { if (ws) ws.send(JSON.stringify({act:'cancel'})); });
  setTimeout(() => {
    document.getElementById('BTN_NEW').disabled = false;
    loadNew();
  }, 800);
}

function _setThemeIcon(isLight) {
  const b = document.getElementById('BTN_THEME');
  if (!b) return;
  b.innerHTML = isLight ? ICON_MOON : ICON_SUN;
  if (isLight) {
    b.style.background = '#3a3f47'; b.style.borderColor = '#3a3f47'; b.style.color = '#c8cdd5';
  } else {
    b.style.background = '#d0d4da'; b.style.borderColor = '#d0d4da'; b.style.color = '#ffffff';
  }
}
function toggleTheme() {
  const light = document.documentElement.classList.toggle('light');
  _setThemeIcon(light);
  localStorage.setItem('asr_offline_theme', light ? 'light' : 'dark');
}
(function(){
  const light = localStorage.getItem('asr_offline_theme') === 'light';
  if (light) document.documentElement.classList.add('light');
  document.addEventListener('DOMContentLoaded', () => _setThemeIcon(light));
})();

function fmt(s) {
  const m=Math.floor(s/60), sec=(s%60).toFixed(1);
  return `${m}:${String(sec).padStart(4,'0')}`;
}

function esc(t) {
  return String(t ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Lang chips ────────────────────────────────────────────────
function buildLangGrid() {
  const grid = document.getElementById('LANG_GRID');
  if (!grid) return;
  const active = new Set([...grid.querySelectorAll('.lang-chip.on')].map(c => c.dataset.lang));
  grid.innerHTML = LANGS.map(l =>
    `<label class="lang-chip ${active.has(l) ? 'on' : ''}" data-lang="${l}" style="${langColorVars(l)}" onclick="this.classList.toggle('on');renderSingleLangList();">
       <span class="lang-chip-dot"></span><span>${langDisplayName(l)}</span></label>`).join('') +
    `<button type="button" class="lang-retranslate-btn" id="BTN_RETRANSLATE_ALL"
       onclick="retranslateAll()" title="${esc(tr('panel.retranslate_title'))}">↻ ${esc(tr('panel.retranslate_all'))}</button>`;
}

// ── Author badge ──────────────────────────────────────────────
const _KNOWN_H2 = '43da6cc6e1b3747553706f17de53cf27beffbf35f617b652893bc1076d5e2ac1';
(async function checkAuthor() {
  try {
    const {token} = await (await fetch('/api/author')).json();
    const buf = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
    const hex = Array.from(new Uint8Array(buf))
                     .map(b=>b.toString(16).padStart(2,'0')).join('');
    const badge = document.getElementById('author-badge');
    if (!badge) return;
    badge.style.display = 'inline';
    if (hex !== _KNOWN_H2) {
      const paths = badge.querySelectorAll('path');
      paths[0]?.setAttribute('fill','#ff440022');
      paths[0]?.setAttribute('stroke','#ff4400');
      paths[1]?.setAttribute('stroke','#ff4400');
      badge.title = '⚠ Unofficial build';
    } else {
      badge.title = '✓ Original release by Lancer1911';
    }
  } catch(e) {}
})();


// ── MP3 Player ────────────────────────────────────────────────
let _audioEl = null, _followMode = true, _seeking = false,
    _audioBlob = null, _audioLoaded = false,
    _pendingAudioFilename = null;   // ASO 加载时记录的原始音频文件名

function initPlayer(audioBytes) {
  // audioBytes is accepted for backward compatibility but no longer used.
  // Blob URLs for large audio files cause inaccurate seek / currentTime reporting
  // in WKWebView (pywebview on macOS). We instead stream directly from /api/audio
  // which supports HTTP Range requests, giving the browser sample-accurate seek.
  if (_audioBlob) { URL.revokeObjectURL(_audioBlob); _audioBlob = null; }
  _audioEl = document.getElementById('AUDIO_EL');
  _audioEl.src = '/api/audio?' + Date.now(); // cache-bust so re-upload works
  _audioEl.load();
  _audioLoaded = true;
  _audioEl.ontimeupdate = onTimeUpdate;
  _audioEl.onended = () => {
    document.getElementById('PLAY_BTN').textContent = '\u25B6';
  };
  _audioEl.onloadedmetadata = () => {
    document.getElementById('PLAY_TIME').textContent =
      '0:00 / ' + fmtTime(_audioEl.duration);
  };
  document.getElementById('PLAYER').classList.add('visible');
  setVol(100);
}

function togglePlay() {
  if (!_audioEl) return;
  if (_audioEl.paused) {
    _audioEl.play();
    document.getElementById('PLAY_BTN').textContent = '⏸';
  } else {
    _audioEl.pause();
    document.getElementById('PLAY_BTN').textContent = '▶';
  }
}

function getTranscriptDuration() {
  if (!_entries || !_entries.length) return 0;
  return Math.max(..._entries.map(e => Number(e.end) || 0), 0);
}

function audioToTranscriptTime(audioTime) {
  // /api/audio serves WAV generated from the exact 16k raw audio used by ASR,
  // so browser currentTime and ASR timestamps should be on the same timeline.
  // Do NOT scale by subtitle-last-end/audio-duration; trailing silence would
  // otherwise make follow and reverse-follow drift.
  return audioTime || 0;
}

function transcriptToAudioTime(transcriptTime) {
  return transcriptTime || 0;
}

function updateSeekUI() {
  if (!_audioEl) return;
  const cur = _audioEl.currentTime || 0, dur = _audioEl.duration || 1;
  const pctNum = Math.max(0, Math.min(100, cur / dur * 100));
  const pct = pctNum.toFixed(2) + '%';
  document.getElementById('SEEK_FILL').style.width  = pct;
  document.getElementById('SEEK_THUMB').style.left  = pct;
  document.getElementById('PLAY_TIME').textContent  =
    fmtTime(cur) + ' / ' + fmtTime(dur);
}

function onTimeUpdate() {
  if (!_audioEl || _seeking) return;
  updateSeekUI();
  if (_followMode) highlightCurrentEntry(audioToTranscriptTime(_audioEl.currentTime || 0));
}

function getActiveEntryIndex(t) {
  if (!_entries || !_entries.length) return -1;
  const EPS_BEFORE = 0.04;
  const EPS_AFTER  = 0.18;

  // Prefer the entry whose actual time span contains the current time.
  for (let i = 0; i < _entries.length; i++) {
    const s = Number(_entries[i].start) || 0;
    const e = Number(_entries[i].end) || s;
    if (t >= s - EPS_BEFORE && t < e + EPS_AFTER) return i;
  }

  // If currentTime falls in a small gap between two cards, keep the nearer card.
  let bestIdx = -1, bestDist = Infinity;
  for (let i = 0; i < _entries.length; i++) {
    const s = Number(_entries[i].start) || 0;
    const e = Number(_entries[i].end) || s;
    const dist = t < s ? s - t : (t > e ? t - e : 0);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
  }
  return bestDist <= 0.45 ? bestIdx : -1;
}

let _lastActiveIdx = -1;
let _lastFollowScrollAt = 0;

function highlightCurrentEntry(t, forceScroll=false) {
  const entries = document.querySelectorAll('.entry');
  const activeIdx = getActiveEntryIndex(t);
  entries.forEach((el, i) => el.classList.toggle('playing', i === activeIdx));

  if (activeIdx >= 0 && _followMode) {
    const active = entries[activeIdx];
    const now = performance.now();
    if (active && (forceScroll || activeIdx !== _lastActiveIdx || now - _lastFollowScrollAt > 1200)) {
      active.scrollIntoView({behavior: forceScroll ? 'auto' : 'smooth', block:'center'});
      _lastFollowScrollAt = now;
    }
  }
  _lastActiveIdx = activeIdx;
}

function seekClick(evt) {
  if (!_audioEl) return;
  const bar  = document.getElementById('SEEK_BAR');
  const rect = bar.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (evt.clientX - rect.left) / rect.width));
  _audioEl.currentTime = frac * (_audioEl.duration || 0);
  updateSeekUI();
  highlightCurrentEntry(audioToTranscriptTime(_audioEl.currentTime || 0), true);
}

function seekToEntry(idx) {
  const e = _entries[idx];
  if (!e || !_audioEl) return;
  const start = Math.max(0, Number(e.start) || 0);
  // Tiny nudge avoids landing just before the segment due to decoding rounding.
  const end = Number(e.end) || start;
  const nudge = Math.min(0.025, Math.max(0, (end - start) / 10));
  _audioEl.currentTime = Math.max(0, transcriptToAudioTime(start + nudge));
  updateSeekUI();
  highlightCurrentEntry(start + nudge, true);
  if (_audioEl.paused) {
    _audioEl.play();
    document.getElementById('PLAY_BTN').textContent = '⏸';
  }
}


function setVol(v) {
  const n = parseFloat(v);
  if (_audioEl) _audioEl.volume = n > 1 ? n / 100 : n;
  const slider = document.getElementById('VOL_SLIDER');
  const thumb  = document.getElementById('VOL_THUMB');
  if (slider) slider.style.background = `linear-gradient(to right,var(--ac) ${n}%,var(--b2) ${n}%)`;
  if (thumb && slider) {
    // 计算圆点在 vol-slider-wrap 内的 left 位置
    // slider: margin 0 5px, width 66px → 在 wrap 中左偏移 5px，有效宽 66px
    const pct = n / 100;
    const sliderLeft = 5;   // margin-left
    const sliderW    = 66;  // width
    thumb.style.left = (sliderLeft + pct * sliderW) + 'px';
  }
}

function toggleMute() {
  if (!_audioEl) return;
  _audioEl.muted = !_audioEl.muted;
  const btn = document.getElementById('VOL_BTN');
  if (btn) btn.innerHTML = _audioEl.muted ? ICON_MUTED : ICON_VOL;
}

function toggleFollow() {
  const sw = document.getElementById('FOLLOW_SW');
  _followMode = sw ? sw.checked : !_followMode;
}


function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return m + ':' + String(sec).padStart(2,'0');
}

// ── Init ──────────────────────────────────────────────────────
// Keep inline onclick compatibility, and also bind explicitly for packaged WebView builds.
window.openAdvancedSettings = openAdvancedSettings;
window.closeAdvancedSettings = closeAdvancedSettings;
window.resetAdvancedSettingsToDefault = resetAdvancedSettingsToDefault;
window.saveAdvancedSettingsFromModal = saveAdvancedSettingsFromModal;
window.saveAdvancedSettingsAndClose = saveAdvancedSettingsAndClose;
const advBtn = document.getElementById('BTN_ADV');
if (advBtn) {
  advBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openAdvancedSettings();
  });
}
buildLangGrid();
_setThemeIcon(document.documentElement.classList.contains('light'));
const vb=document.getElementById('VOL_BTN'); if(vb) vb.innerHTML=ICON_VOL;
connect();
