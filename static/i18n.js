/* =============================================================
 *  i18n.js  —  Lancer1911 ASR Offline 中英双语切换支持
 *  ----------------------------------------------------------
 *  设计原则：
 *    1. 所有可见 UI 文本通过 t(key) / data-i18n 取出
 *    2. 默认语言 = 浏览器 navigator.language；用户选择持久化到 localStorage
 *    3. applyI18n() 负责一次性回填所有静态 DOM
 *    4. 提供 translateBackendMsg() 把后端发回的中文进度信息转成当前语言
 *  ============================================================= */

(function () {

const STORAGE_KEY = 'asr_offline_lang';

// ── 主翻译表 ────────────────────────────────────────────────────
const I18N = {
  zh: {
    /* Topbar */
    'topbar.connecting':       '连接中…',
    'topbar.ready':             '就绪',
    'topbar.btn_load':          '加载',
    'topbar.btn_save':          '保存',
    'topbar.btn_new':           '新文件',
    'topbar.btn_load_title':   '加载 ASO 会话文件',
    'topbar.btn_save_title':   '保存完整会话（.aso）',
    'topbar.btn_lang_title':   '切换语言 / Switch language',
    'sci.mode_title':          '切换科幻展示效果',
    'sci.mode_button':         '切换效果：{mode}',
    'sci.mode_aurora':         '流光溢彩',
    'sci.mode_matrix':         '黑客帝国',


    /* Advanced settings */
    'adv.btn_title':           '高级参数设置',
    'adv.title':               '高级 ASR / LLM 参数',
    'adv.close':               '关闭',
    'adv.intro':               '这些参数来自当前版本中 ASR 和 LLM 流程原本写死的默认数值。建议先使用默认值；只有在识别空白、幻觉、分句过细、翻译截断或速度/质量需要权衡时再调整。',
    'adv.asr_section':         'ASR 参数',
    'adv.llm_section':         'LLM 参数',
    'adv.reset':               '恢复默认值',
    'adv.apply':               '应用到设置',
    'adv.save_close':          '保存并关闭',
    'adv.on':                  '开',
    'adv.off':                 '关',
    'adv.asr_temperature.title':'ASR 随机性',
    'adv.asr_temperature.help':'默认 0。越高越可能探索不同文本，但也更容易不稳定；法律/技术录音建议保持 0。',
    'adv.asr_condition_on_previous_text.title':'参考前文',
    'adv.asr_condition_on_previous_text.help':'默认关闭。关闭可降低前文污染和重复幻觉；若长音频上下文连续性不足，可尝试开启。',
    'adv.asr_no_speech_threshold.title':'无语音阈值',
    'adv.asr_no_speech_threshold.help':'默认 0.45。越高越不容易把片段判为空白；空白太多可升高，噪音被识别成文字可降低。',
    'adv.asr_compression_ratio_threshold.title':'压缩率过滤阈值',
    'adv.asr_compression_ratio_threshold.help':'默认 1.8。用于过滤异常重复/压缩文本；重复幻觉多时可适当降低，漏识别时可适当升高。',
    'adv.asr_logprob_threshold.title':'置信度过滤阈值',
    'adv.asr_logprob_threshold.help':'默认 -1.0。越高越严格；误识别噪音多可升高，漏字多可降低。',
    'adv.asr_fp16.title':'FP16 推理',
    'adv.asr_fp16.help':'默认开启。通常更快、更省内存；如遇模型/设备兼容问题可关闭。',
    'adv.llm_temperature.title':'LLM 随机性',
    'adv.llm_temperature.help':'默认 0。越高表达越发散，但纠错/翻译稳定性下降；建议保持 0。',
    'adv.llm_context_prompt_max_chars.title':'提示词截取长度',
    'adv.llm_context_prompt_max_chars.help':'默认 300 字。增加可提供更多术语背景，但会占用上下文并略降速度。',
    'adv.llm_phase1_chunk_max_chars.title':'Phase 1 分块长度',
    'adv.llm_phase1_chunk_max_chars.help':'默认 350 字。越大上下文更完整但更慢、更易超长；越小更稳但可能割裂语义。',
    'adv.llm_phase1_max_tokens.title':'Phase 1 最大输出',
    'adv.llm_phase1_max_tokens.help':'默认 1200。Phase 1 输出被截断时可增大；过大可能降低速度。',
    'adv.llm_phase1_min_length_ratio.title':'Phase 1 最短比例保护',
    'adv.llm_phase1_min_length_ratio.help':'默认 0.5。LLM 输出短于原 chunk 该比例时回退 ASR 原文；可防止过度删减。',
    'adv.llm_phase2_base_max_tokens.title':'Phase 2 基础输出',
    'adv.llm_phase2_base_max_tokens.help':'默认 1200。控制单句最终纠错的基础输出上限；长句被截断时可增大。',
    'adv.llm_phase2_tokens_per_target_lang.title':'Phase 2 每种翻译增量',
    'adv.llm_phase2_tokens_per_target_lang.help':'默认 600。同步翻译目标语言越多，需要越高；翻译截断时可增大。',
    'adv.llm_translate_base_tokens.title':'单句翻译基础输出',
    'adv.llm_translate_base_tokens.help':'默认 800。用于手动/批量翻译单条字幕的基础 token 预算。',
    'adv.llm_translate_tokens_per_target_lang.title':'单句翻译每语种增量',
    'adv.llm_translate_tokens_per_target_lang.help':'默认 350。目标语种越多越需要增大；过大则速度变慢。',
    'adv.llm_translate_max_tokens_cap.title':'单句翻译输出上限',
    'adv.llm_translate_max_tokens_cap.help':'默认 2400。是单句翻译 token 预算的封顶值，避免多语种翻译失控。',

    /* Phase bar */
    'phase.upload':             '① 上传',
    'phase.asr':                '② ASR',
    'phase.correct':            '③ 纠错',
    'phase.speaker':            '④ 说话人',
    'phase.review':             '⑤ 校对',

    /* Speaker rename popup */
    'spk.popup_title':          '重命名说话人',
    'spk.popup_placeholder':    '输入新名称…',
    'spk.popup_cancel':         '取消',
    'spk.popup_confirm':        '确认',
    'spk.rename_tooltip':       '点击重命名',

    /* Drop zone */
    'drop.label_main':          '拖放音频 / 视频文件到此处',
    'drop.label_or':            '或',
    'drop.label_click':         '点击选择文件',
    'drop.hint':                '支持 MP3 · MP4 · M4A · WAV · FLAC · AAC · OGG',

    /* Progress / file card */
    'prog.processing':          '处理中…',
    'prog.cancel':              '取消',
    'prog.cancelling':          '取消中…',
    'prog.cancelled':           '已取消',
    'prog.cancel_reload':       '正在取消，重新加载模型…',
    'fc.duration':              '时长',
    'fc.format':                '格式',
    'fc.bitrate':               '码率',
    'fc.samplerate':            '采样率',
    'fc.channels':              '声道',
    'fc.size':                  '大小',
    'fc.warn':                  '⚠ 文件可能损坏或不含音频轨道',
    'fc.btn_start':             '开始转录',
    'fc.btn_start_running':     '转录中…',
    'fc.btn_reset':             '重新选择',

    /* Export bar */

    /* Subtitle search */
    'search.label':              '搜索字幕',
    'search.mode_text':          '关键词',
    'search.mode_regex':         '正则',
    'search.mode_speaker':       '发言人',
    'search.placeholder_text':   '输入关键词…',
    'search.placeholder_regex':  '正则；可用 AND / OR，例如：同志 AND 主义、专利 OR claim、第\\d+条',
    'search.clear':              '清除',
    'search.count':              '显示 N / M 条',
    'search.no_match':           '没有匹配的字幕卡片',
    'search.regex_error':        '正则表达式无效',
    'search.no_speaker':         '无发言人',
    'search.toggle_title':       '搜索字幕',
    'search.toggle_title_close': '隐藏搜索',

    'export.label':             '导出：',
    'export.mixed':             '混合',
    'export.single':            '单语',
    'export.mixed_title':       '混合语言：原文+翻译+说话人+时间戳',
    'export.single_title':      '单一语言：从已启用翻译语言中选择',
    'export.menu_mixed_title':  '混合语言（原文 + 翻译）',
    'export.menu_single_title': '选择语言后选格式',
    'export.json_full':         'JSON（完整数据）',
    'export.cancel':            '取消',
    'export.btn_debug_title_open': '展开调试面板',
    'export.btn_debug_title_close':'收起调试面板',
    'export.choose_lang_first': '请先选择语言',

    /* Debug panel */
    'dbg.title':                '调试面板 v0.6n',
    'dbg.btn_raw':              'ASR 原始文字',
    'dbg.btn_segments':         'ASR Segments',
    'dbg.btn_timestamps':       '时间戳对比',
    'dbg.btn_copy':             '复制',
    'dbg.btn_copy_title':       '复制调试内容到剪贴板',
    'dbg.btn_copy_done':        '已复制',
    'dbg.btn_clear':            '清空',
    'dbg.btn_output_off':       '输出调试文件：关',
    'dbg.btn_output_on':        '输出调试文件：开',
    'dbg.btn_output_title':     '开启后每次处理会在 ~/Downloads/ 输出 JSON 调试文件（ASR原始/Phase1/Phase2/说话人识别）',
    'dbg.output_hint':          '调试 JSON 文件将保存到',
    'dbg.output_hint_format':   '，格式：',
    'dbg.raw_header':           '── ASR 原始文字 ──',
    'dbg.raw_empty':            '（无）',
    'dbg.raw_chars':            '共 N 字符',
    'dbg.seg_empty':            '无 ASR Segments',
    'dbg.seg_header':           '── ASR Segments（共 N 段）──',
    'dbg.seg_words':            'words',
    'dbg.seg_words_brief':      '（N 词，仅显示前10/后5）',
    'dbg.ts_no_entries':        '尚无字幕条目',
    'dbg.ts_header':            '── 时间戳对比（N 条，音频时长 D）──',
    'dbg.ts_backend':           'ASR backend: ',
    'dbg.ts_segs_n':            'N段',
    'dbg.ts_segs_no':           '无segment',
    'dbg.ts_word_ts':           'Segments 有词级时间戳: ',
    'dbg.ts_yes':               '✓是',
    'dbg.ts_no':                '✗否（整段估算）',
    'dbg.ts_mismatch':          '⚠ ASR:',

    /* Subtitle entry */
    'entry.no_content':         '未识别到内容',
    'entry.btn_edit':           '修改',
    'entry.btn_translate':      '翻译',
    'entry.btn_raw':            '原始',
    'entry.btn_save':           '保存',
    'entry.btn_save_translate': '保存并翻译',
    'entry.btn_cancel':         '取消',
    'entry.asr_anchor_time':    '锚定时间',
    'entry.asr_ts_mismatch':    '⚠ 与显示时间不符',

    /* Player */
    'player.play_title':        '播放/暂停',
    'player.mute_title':        '静音/取消静音',
    'player.follow':            '跟随',

    /* Right panel */
    'panel.whisper':            'Whisper ASR 模型',
    'panel.llm':                'LLM 模型',
    'panel.recog_lang':         '识别语言',
    'panel.lang_auto':          '自动检测',
    'panel.lang_zh':            '中文',
    'panel.lang_en':             '英文',
    'panel.lang_ja':             '日文',
    'panel.lang_ko':             '韩文',
    'panel.lang_yue':            '粤语',
    'panel.translate_target':   '翻译目标（校对时按需）',
    'panel.retranslate_all':    '重新翻译全文',
    'panel.retranslate_title':  '按当前勾选的目标语言重新翻译全部字幕',
    'panel.retranslate_running':'重新翻译中…',
    'panel.context_prompt':     '场景提示词',
    'panel.context_placeholder':'领域背景和关键术语…',
    'panel.diarize':            '说话人识别',
    'panel.diarize_enable':     '启用说话人识别',
    'panel.diarize_auto':       'LLM完成后自动运行',
    'panel.diarize_threshold':  '聚类阈值（敏感度）',
    'panel.diarize_strict':     '严格（0.01 更多分组）',
    'panel.diarize_loose':      '宽松（0.50 更少分组）',
    'panel.diarize_redo':       '重新识别',
    'panel.diarize_recluster':  '仅重新聚类',
    'panel.diarize_redo_title': '重新提取声纹并聚类',
    'panel.diarize_recluster_title':'保留声纹，仅按新阈值重新聚类',
    'panel.diarize_running':    '识别中…',
    'panel.diarize_clustering': '聚类中…',
    'panel.diarize_count_n':    '识别到 N 位说话人',
    'panel.diarize_unit':       '句',
    'panel.btn_save_settings':  '保存设置',
    'panel.no_models':          '（未检测到模型）',

    /* Translation language names (中文 sidebar) */
    'lang.zh':                  '中文',
    'lang.en':                  '英文',
    'lang.ja':                  '日文',
    'lang.ko':                  '韩文',
    'lang.fr':                  '法文',
    'lang.de':                  '德文',
    'lang.es':                  '西班牙文',

    /* Misc / alerts / messages */
    'msg.warmup_prefix':        '⏳ ',
    'msg.session_loaded':       '会话已加载（N 条）',
    'msg.session_loaded_audio': '会话已加载，音频已自动配对（N 条）',
    'msg.complete_n':           '完成（N 条）',
    'msg.diarize_complete':     '说话人识别完成（N 位）',
    'msg.diarize_partial':      ' ⚠ 部分失败',
    'msg.translating_n':        '翻译中 N/M…',
    'msg.translate_done':       '翻译完成',
    'msg.choose_translate_lang':'请选择至少一种翻译目标语言',
    'msg.retranslate_failed':   '重新翻译失败',
    'msg.checking_file':        '检查文件…',
    'msg.error_check':          '检查失败',
    'msg.error_start':          '启动失败',
    'msg.error_prefix':         '错误: ',
    'msg.asr_running':          'ASR 转录中…',
    'msg.recluster_running':    '重新聚类中…',
    'msg.embed_extracting':     '声纹提取中…',
    'msg.diarize_failed':       '说话人识别失败：',
    'msg.alert_warmup':         '模型尚未就绪，请等待预热完成。',
    'msg.alert_need_correct':   '请先完成 ASR 和 LLM 纠错。',
    'msg.alert_parse_aso':      '文件格式错误，无法解析 JSON。',
    'msg.alert_load_fail':      '加载失败：',
    'msg.alert_read_fail':      '读取失败：',
    'msg.unknown_error':        '未知错误',
    'msg.aso_session':          'ASO 会话文件',
    'msg.subtitle_mixed':       '混合语言字幕文件',
    'msg.subtitle_single':      'X 字幕文件',
    'msg.audio_loading':        '正在加载配对音频…',
    'msg.audio_paired':         '配对音频已加载，可跟随播放',

    /* Backend-emitted progress messages — patterns we recognize */
    'be.asr_done':              'ASR 完成（${ms}ms），LLM 纠错中…',
    'be.llm_done_diarize':      'LLM 完成（${ms}ms），翻译已启动，说话人识别中…',
    'be.complete_ms':           '完成（${ms}ms）',
    'be.whisper_running':       'Whisper ASR 转录中…',
    'be.phase1_correct':        'Phase 1 纠错 ${i}/${n}…',
    'be.phase2_correct':        'Phase 2 精细纠错 ${i}/${n}…',
    'be.asr_error':             'ASR: ${err}',

    /* Author badge */
    'auth.original':            '✓ 原版发布 by Lancer1911',
    'auth.unofficial':          '⚠ 非官方构建',
  },

  en: {
    /* Topbar */
    'topbar.connecting':       'Connecting…',
    'topbar.ready':             'Ready',
    'topbar.btn_load':          'Load',
    'topbar.btn_save':          'Save',
    'topbar.btn_new':           'New File',
    'topbar.btn_load_title':   'Load ASO session file',
    'topbar.btn_save_title':   'Save full session (.aso)',
    'topbar.btn_lang_title':   '切换语言 / Switch language',
    'sci.mode_title':          'Switch sci-fi preview effect',
    'sci.mode_button':         'Effect: {mode}',
    'sci.mode_aurora':         'Aurora Flow',
    'sci.mode_matrix':         'Matrix Trail',


    /* Advanced settings */
    'adv.btn_title':           'Advanced parameter settings',
    'adv.title':               'Advanced ASR / LLM Parameters',
    'adv.close':               'Close',
    'adv.intro':               'These parameters are the hard-coded ASR and LLM defaults used by this version. Keep the defaults first; adjust them only when you see blank recognition, hallucination, over-fragmented sentences, truncated translations, or a speed/quality trade-off.',
    'adv.asr_section':         'ASR parameters',
    'adv.llm_section':         'LLM parameters',
    'adv.reset':               'Restore defaults',
    'adv.apply':               'Apply to settings',
    'adv.save_close':          'Save and close',
    'adv.on':                  'On',
    'adv.off':                 'Off',
    'adv.asr_temperature.title':'ASR temperature',
    'adv.asr_temperature.help':'Default 0. Higher values may explore alternatives but are less stable; keep 0 for legal/technical recordings.',
    'adv.asr_condition_on_previous_text.title':'Condition on previous text',
    'adv.asr_condition_on_previous_text.help':'Default off. Turning it off reduces previous-text contamination and repetition; turn it on if long-audio continuity is insufficient.',
    'adv.asr_no_speech_threshold.title':'No-speech threshold',
    'adv.asr_no_speech_threshold.help':'Default 0.45. Higher values make blanks less likely; increase for too many blanks, lower if noise becomes text.',
    'adv.asr_compression_ratio_threshold.title':'Compression-ratio threshold',
    'adv.asr_compression_ratio_threshold.help':'Default 1.8. Filters abnormal repeated/compressed output; lower it if repeated hallucinations occur, raise it if speech is dropped.',
    'adv.asr_logprob_threshold.title':'Log-probability threshold',
    'adv.asr_logprob_threshold.help':'Default -1.0. Higher is stricter; raise it for noisy false text, lower it if real speech is dropped.',
    'adv.asr_fp16.title':'FP16 inference',
    'adv.asr_fp16.help':'Default on. Usually faster and lighter; turn off only for model/device compatibility issues.',
    'adv.llm_temperature.title':'LLM temperature',
    'adv.llm_temperature.help':'Default 0. Higher values are more creative but less stable for correction/translation; 0 is recommended.',
    'adv.llm_context_prompt_max_chars.title':'Context prompt length',
    'adv.llm_context_prompt_max_chars.help':'Default 300 chars. More context can help terminology but consumes context and may slow processing.',
    'adv.llm_phase1_chunk_max_chars.title':'Phase 1 chunk length',
    'adv.llm_phase1_chunk_max_chars.help':'Default 350 chars. Larger chunks preserve context but are slower and risk long outputs; smaller chunks are steadier but may split meaning.',
    'adv.llm_phase1_max_tokens.title':'Phase 1 max output',
    'adv.llm_phase1_max_tokens.help':'Default 1200. Increase if Phase 1 output is truncated; larger values may slow processing.',
    'adv.llm_phase1_min_length_ratio.title':'Phase 1 minimum-length guard',
    'adv.llm_phase1_min_length_ratio.help':'Default 0.5. If LLM output is shorter than this ratio of the original chunk, the app falls back to ASR text to avoid over-deletion.',
    'adv.llm_phase2_base_max_tokens.title':'Phase 2 base output',
    'adv.llm_phase2_base_max_tokens.help':'Default 1200. Base token budget for final sentence correction; increase for truncated long sentences.',
    'adv.llm_phase2_tokens_per_target_lang.title':'Phase 2 tokens per target language',
    'adv.llm_phase2_tokens_per_target_lang.help':'Default 600. More target languages need a larger budget; increase if synchronized translations are truncated.',
    'adv.llm_translate_base_tokens.title':'Entry translation base output',
    'adv.llm_translate_base_tokens.help':'Default 800. Base token budget for manual/batch translation of one subtitle entry.',
    'adv.llm_translate_tokens_per_target_lang.title':'Entry translation tokens per language',
    'adv.llm_translate_tokens_per_target_lang.help':'Default 350. Increase for multiple target languages; larger values slow translation.',
    'adv.llm_translate_max_tokens_cap.title':'Entry translation output cap',
    'adv.llm_translate_max_tokens_cap.help':'Default 2400. Caps the token budget for one entry translation to prevent runaway multi-language output.',

    /* Phase bar */
    'phase.upload':             '① Upload',
    'phase.asr':                '② ASR',
    'phase.correct':            '③ Correct',
    'phase.speaker':            '④ Speaker',
    'phase.review':             '⑤ Review',

    /* Speaker rename popup */
    'spk.popup_title':          'Rename Speaker',
    'spk.popup_placeholder':    'Enter new name…',
    'spk.popup_cancel':         'Cancel',
    'spk.popup_confirm':        'OK',
    'spk.rename_tooltip':       'Click to rename',

    /* Drop zone */
    'drop.label_main':          'Drag & drop audio / video file here',
    'drop.label_or':            'or',
    'drop.label_click':         'click to select a file',
    'drop.hint':                'Supports MP3 · MP4 · M4A · WAV · FLAC · AAC · OGG',

    /* Progress / file card */
    'prog.processing':          'Processing…',
    'prog.cancel':              'Cancel',
    'prog.cancelling':          'Cancelling…',
    'prog.cancelled':           'Cancelled',
    'prog.cancel_reload':       'Cancelling, reloading model…',
    'fc.duration':              'Duration',
    'fc.format':                'Format',
    'fc.bitrate':               'Bitrate',
    'fc.samplerate':            'Sample rate',
    'fc.channels':              'Channels',
    'fc.size':                  'Size',
    'fc.warn':                  '⚠ File may be corrupted or contains no audio track',
    'fc.btn_start':             'Start Transcription',
    'fc.btn_start_running':     'Transcribing…',
    'fc.btn_reset':             'Choose another',

    /* Export bar */

    /* Subtitle search */
    'search.label':              'Search',
    'search.mode_text':          'Keyword',
    'search.mode_regex':         'Regex',
    'search.mode_speaker':       'Speaker',
    'search.placeholder_text':   'Enter keyword…',
    'search.placeholder_regex':  'Regex; AND / OR supported, e.g. patent AND claim, apple OR orange, Article \\d+',
    'search.clear':              'Clear',
    'search.count':              'Showing N / M',
    'search.no_match':           'No matching subtitle cards',
    'search.regex_error':        'Invalid regular expression',
    'search.no_speaker':         'No speakers',
    'search.toggle_title':       'Search subtitles',
    'search.toggle_title_close': 'Hide search',

    'export.label':             'Export:',
    'export.mixed':             'Mixed',
    'export.single':            'Single',
    'export.mixed_title':       'Mixed: source + translations + speakers + timestamps',
    'export.single_title':      'Single language: choose from enabled translation targets',
    'export.menu_mixed_title':  'Mixed (source + translations)',
    'export.menu_single_title': 'Choose language, then format',
    'export.json_full':         'JSON (full data)',
    'export.cancel':            'Cancel',
    'export.btn_debug_title_open': 'Expand debug panel',
    'export.btn_debug_title_close':'Collapse debug panel',
    'export.choose_lang_first': 'Please select a language first',

    /* Debug panel */
    'dbg.title':                'Debug Panel v0.6n',
    'dbg.btn_raw':              'ASR Raw Text',
    'dbg.btn_segments':         'ASR Segments',
    'dbg.btn_timestamps':       'Timestamp Diff',
    'dbg.btn_copy':             'Copy',
    'dbg.btn_copy_title':       'Copy debug content to clipboard',
    'dbg.btn_copy_done':        'Copied',
    'dbg.btn_clear':            'Clear',
    'dbg.btn_output_off':       'Output debug files: OFF',
    'dbg.btn_output_on':        'Output debug files: ON',
    'dbg.btn_output_title':     'When ON, each run writes JSON debug files to ~/Downloads/ (ASR raw / Phase 1 / Phase 2 / diarize)',
    'dbg.output_hint':          'Debug JSON files will be saved to',
    'dbg.output_hint_format':   ', format:',
    'dbg.raw_header':           '── ASR Raw Text ──',
    'dbg.raw_empty':            '(none)',
    'dbg.raw_chars':            'N characters total',
    'dbg.seg_empty':            'No ASR Segments',
    'dbg.seg_header':           '── ASR Segments (N segments) ──',
    'dbg.seg_words':            'words',
    'dbg.seg_words_brief':      '(N words; showing first 10 / last 5)',
    'dbg.ts_no_entries':        'No subtitle entries yet',
    'dbg.ts_header':            '── Timestamp Diff (N entries, audio duration D) ──',
    'dbg.ts_backend':           'ASR backend: ',
    'dbg.ts_segs_n':            'N segs',
    'dbg.ts_segs_no':           'no segment',
    'dbg.ts_word_ts':           'Segments have word-level timestamps: ',
    'dbg.ts_yes':               '✓yes',
    'dbg.ts_no':                '✗no (estimated by segment)',
    'dbg.ts_mismatch':          '⚠ ASR:',

    /* Subtitle entry */
    'entry.no_content':         'No content recognized',
    'entry.btn_edit':           'Edit',
    'entry.btn_translate':      'Translate',
    'entry.btn_raw':            'Raw',
    'entry.btn_save':           'Save',
    'entry.btn_save_translate': 'Save & Translate',
    'entry.btn_cancel':         'Cancel',
    'entry.asr_anchor_time':    'Anchored at',
    'entry.asr_ts_mismatch':    '⚠ does not match display time',

    /* Player */
    'player.play_title':        'Play/Pause',
    'player.mute_title':        'Mute/Unmute',
    'player.follow':            'Follow',

    /* Right panel */
    'panel.whisper':            'Whisper ASR Model',
    'panel.llm':                'LLM Model',
    'panel.recog_lang':         'Recognition Language',
    'panel.lang_auto':          'Auto-detect',
    'panel.lang_zh':            'Chinese',
    'panel.lang_en':            'English',
    'panel.lang_ja':            'Japanese',
    'panel.lang_ko':            'Korean',
    'panel.lang_yue':           'Cantonese',
    'panel.translate_target':   'Translation Targets (on demand)',
    'panel.retranslate_all':    'Retranslate All',
    'panel.retranslate_title':  'Retranslate all subtitles using the currently selected target languages',
    'panel.retranslate_running':'Retranslating…',
    'panel.context_prompt':     'Context Prompt',
    'panel.context_placeholder':'Domain context and key terms…',
    'panel.diarize':            'Speaker Diarization',
    'panel.diarize_enable':     'Enable speaker diarization',
    'panel.diarize_auto':       'Run automatically after LLM',
    'panel.diarize_threshold':  'Cluster threshold (sensitivity)',
    'panel.diarize_strict':     'Strict (0.01 — more groups)',
    'panel.diarize_loose':      'Loose (0.50 — fewer groups)',
    'panel.diarize_redo':       'Redo',
    'panel.diarize_recluster':  'Recluster only',
    'panel.diarize_redo_title': 'Re-extract embeddings and cluster',
    'panel.diarize_recluster_title':'Keep embeddings, recluster with new threshold',
    'panel.diarize_running':    'Recognizing…',
    'panel.diarize_clustering': 'Clustering…',
    'panel.diarize_count_n':    'Detected N speaker(s)',
    'panel.diarize_unit':       'utt.',
    'panel.btn_save_settings':  'Save Settings',
    'panel.no_models':          '(no model detected)',

    /* Translation language names */
    'lang.zh':                  'Chinese',
    'lang.en':                  'English',
    'lang.ja':                  'Japanese',
    'lang.ko':                  'Korean',
    'lang.fr':                  'French',
    'lang.de':                  'German',
    'lang.es':                  'Spanish',

    /* Misc / alerts */
    'msg.warmup_prefix':        '⏳ ',
    'msg.session_loaded':       'Session loaded (N entries)',
    'msg.session_loaded_audio': 'Session loaded, audio auto-paired (N entries)',
    'msg.complete_n':           'Done (N entries)',
    'msg.diarize_complete':     'Diarization done (N speakers)',
    'msg.diarize_partial':      ' ⚠ Partial failure',
    'msg.translating_n':        'Translating N/M…',
    'msg.translate_done':       'Translation done',
    'msg.choose_translate_lang':'Please select at least one translation target language',
    'msg.retranslate_failed':   'Retranslation failed',
    'msg.checking_file':        'Checking file…',
    'msg.error_check':          'Check failed',
    'msg.error_start':          'Failed to start',
    'msg.error_prefix':         'Error: ',
    'msg.asr_running':          'ASR transcribing…',
    'msg.recluster_running':    'Reclustering…',
    'msg.embed_extracting':     'Extracting voice embeddings…',
    'msg.diarize_failed':       'Diarization failed: ',
    'msg.alert_warmup':         'Model is not ready yet, please wait for warmup.',
    'msg.alert_need_correct':   'Please complete ASR and LLM correction first.',
    'msg.alert_parse_aso':      'Invalid file format, JSON parse failed.',
    'msg.alert_load_fail':      'Load failed: ',
    'msg.alert_read_fail':      'Read failed: ',
    'msg.unknown_error':        'Unknown error',
    'msg.aso_session':          'ASO session file',
    'msg.subtitle_mixed':       'Mixed-language subtitle file',
    'msg.subtitle_single':      'X subtitle file',
    'msg.audio_loading':        'Loading paired audio…',
    'msg.audio_paired':         'Paired audio loaded — follow & playback ready',

    /* Backend-emitted message templates */
    'be.asr_done':              'ASR done (${ms}ms), LLM correcting…',
    'be.llm_done_diarize':      'LLM done (${ms}ms), translation queued, diarizing…',
    'be.complete_ms':           'Done (${ms}ms)',
    'be.whisper_running':       'Whisper ASR transcribing…',
    'be.phase1_correct':        'Phase 1 correcting ${i}/${n}…',
    'be.phase2_correct':        'Phase 2 fine-tuning ${i}/${n}…',
    'be.asr_error':             'ASR: ${err}',

    /* Author badge */
    'auth.original':            '✓ Original release by Lancer1911',
    'auth.unofficial':          '⚠ Unofficial build',
  },
};

// ── State ───────────────────────────────────────────────────────
let _lang = (() => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && I18N[saved]) return saved;
  // Auto-detect from browser
  const nav = (navigator.language || 'zh').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
})();

// ── Public API ──────────────────────────────────────────────────
function t(key, vars) {
  const dict = I18N[_lang] || I18N.zh;
  let s = dict[key];
  if (s === undefined) s = (I18N.zh[key] !== undefined ? I18N.zh[key] : key);
  if (vars && typeof s === 'string') {
    for (const k in vars) {
      s = s.replaceAll('${' + k + '}', vars[k]);
      // 也支持 N / M / D / X 这种简单占位（当 key 中只有 N 时）
    }
  }
  return s;
}

function getLang() { return _lang; }

function setLang(l) {
  if (!I18N[l]) return;
  _lang = l;
  localStorage.setItem(STORAGE_KEY, l);
  applyI18n();
  // 让外部模块（lang chip 网格、字幕渲染等）有机会重绘
  document.dispatchEvent(new CustomEvent('i18n:changed', {detail: {lang: l}}));
}

function toggleLang() {
  setLang(_lang === 'zh' ? 'en' : 'zh');
}

/** 把数字 N / M / D 等占位符替换进字符串里 */
function fmt(template, map) {
  let s = template;
  for (const k in map) s = s.replace(k, map[k]);
  return s;
}

/* -----------------------------------------------------------
 * 把 server.py / model_worker.py 发回来的中文 msg 翻成当前语言。
 * 用正则匹配几个固定模式；命中则用 i18n 模板替换，
 * 没命中就原样返回（保持向后兼容）。
 * --------------------------------------------------------- */
function translateBackendMsg(zhMsg) {
  if (!zhMsg || typeof zhMsg !== 'string') return zhMsg || '';
  if (_lang === 'zh') return zhMsg;     // 中文模式直接透传

  let m;

  // ASR 完成（{ms}ms），LLM 纠错中…
  m = zhMsg.match(/^ASR\s*完成（(\d+)ms）[，,]\s*LLM\s*纠错中…?$/);
  if (m) return t('be.asr_done', {ms: m[1]});

  // LLM 完成（{ms}ms），翻译已启动，说话人识别中…
  m = zhMsg.match(/^LLM\s*完成（(\d+)ms）[，,]\s*翻译已启动[，,]\s*说话人识别中…?$/);
  if (m) return t('be.llm_done_diarize', {ms: m[1]});

  // 完成（{ms}ms）
  m = zhMsg.match(/^完成（(\d+)ms）$/);
  if (m) return t('be.complete_ms', {ms: m[1]});

  // 完成（N 条）
  m = zhMsg.match(/^完成（(\d+)\s*条）$/);
  if (m) return fmt(t('msg.complete_n'), {N: m[1]});

  // Whisper ASR 转录中…
  if (/^Whisper\s*ASR\s*转录中…?$/.test(zhMsg)) return t('be.whisper_running');

  // Phase 1 纠错 i/n…
  m = zhMsg.match(/^Phase\s*1\s*纠错\s*(\d+)\/(\d+)…?$/);
  if (m) return t('be.phase1_correct', {i: m[1], n: m[2]});

  // Phase 2 精细纠错 i/n…
  m = zhMsg.match(/^Phase\s*2\s*精细纠错\s*(\d+)\/(\d+)…?$/);
  if (m) return t('be.phase2_correct', {i: m[1], n: m[2]});

  // ASR: <err>
  m = zhMsg.match(/^ASR:\s*([\s\S]+)$/);
  if (m) return t('be.asr_error', {err: m[1]});

  // 已取消 / cancelled (server returns plain '已取消')
  if (zhMsg === '已取消') return t('prog.cancelled');

  // Default — return as-is
  return zhMsg;
}

/* -----------------------------------------------------------
 *  applyI18n() — 把 data-i18n / data-i18n-attr / data-i18n-html
 *  全部回填一次。
 * --------------------------------------------------------- */
function applyI18n(root) {
  root = root || document;

  // 1. 普通文本节点：data-i18n="<key>"
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });

  // 2. 任意属性：data-i18n-<attr>="<key>" e.g. data-i18n-title, data-i18n-placeholder
  root.querySelectorAll('*').forEach(el => {
    for (const a of el.attributes) {
      if (!a.name.startsWith('data-i18n-')) continue;
      // skip data-i18n-html (handled separately)
      if (a.name === 'data-i18n-html') continue;
      const attr = a.name.slice('data-i18n-'.length);
      el.setAttribute(attr, t(a.value));
    }
  });

  // 3. data-i18n-html — 允许 HTML 片段（用于含 <b> 等结构）
  root.querySelectorAll('[data-i18n-html]').forEach(el => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key);
  });

  // 4. <html lang>
  document.documentElement.setAttribute('lang', _lang);

  // 5. document.title
  if (I18N[_lang]['app.title']) document.title = t('app.title');

  // 6. 切换按钮的 label（显示 "EN" 时 = 当前是中文，可点击切到英文）
  const langBtn = document.getElementById('BTN_LANG');
  if (langBtn) {
    langBtn.textContent = _lang === 'zh' ? 'EN' : '中';
    langBtn.title = t('topbar.btn_lang_title');
  }
}

// ── Expose ──────────────────────────────────────────────────────
window.I18N = {
  t,
  getLang,
  setLang,
  toggleLang,
  applyI18n,
  translateBackendMsg,
  fmt,
};

})();
