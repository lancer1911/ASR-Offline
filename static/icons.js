/* =============================================================
 *  icons.js  —  Lancer1911 ASR Offline SVG 图标库
 *  ----------------------------------------------------------
 *  替换原本的 emoji 字符（📂 💾 📋 📁 🎙 ⏳ ✅ ⚠️ 等），
 *  使用扁平、风格统一的 stroke=currentColor SVG 图标。
 *  ----------------------------------------------------------
 *  设计要点：
 *    · 全部 1.6 stroke-width 线性图标，与现有 SVG 风格一致
 *    · viewBox 24x24，统一接口；调用方传入 size + extra style
 *    · stroke="currentColor"，颜色随父元素 color 自动变化
 *    · 大多数图标有内部 fill 留空，hover 高亮通过 currentColor
 *  ============================================================= */

(function () {

/** 通用包装：返回带尺寸/类名的 SVG 字符串 */
function svg(inner, opts = {}) {
  const size = opts.size || 14;
  const cls  = opts.className ? ` class="${opts.className}"` : '';
  const styl = opts.style ? ` style="${opts.style}"` : '';
  return `<svg${cls}${styl} width="${size}" height="${size}" viewBox="0 0 24 24" `
       + `fill="none" stroke="currentColor" stroke-width="1.6" `
       + `stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

/* === 基础动作图标 ============================================ */

/** 📂 文件夹（加载 / 打开） */
const FOLDER_OPEN = `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7Z"/>`
                  + `<path d="M3 8h18l-2 9a2 2 0 0 1-2 1.6H6.5A2 2 0 0 1 4.5 17L3 8Z"/>`;

/** 💾 保存（软盘） */
const SAVE = `<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/>`
           + `<path d="M7 4v5h8V4"/>`
           + `<rect x="7" y="13" width="10" height="6" rx="0.6"/>`;

/** ＋ 新文件（带文档轮廓） */
const FILE_PLUS = `<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/>`
                + `<path d="M14 3v5h5"/>`
                + `<path d="M12 12v6M9 15h6"/>`;

/** 📋 复制（剪贴板） */
const COPY = `<rect x="9" y="3" width="6" height="3" rx="0.6"/>`
           + `<path d="M9 4.5H6.5A1.5 1.5 0 0 0 5 6v13a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V6a1.5 1.5 0 0 0-1.5-1.5H15"/>`;

/** 📁 输出文件夹（带向下箭头） */
const FOLDER_DOWN = `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>`
                  + `<path d="M12 11v5"/>`
                  + `<path d="M9.5 14L12 16.2 14.5 14"/>`;

/* === 状态指示图标 =========================================== */

/** ⏳ 沙漏（预热中） */
const HOURGLASS = `<path d="M7 3h10"/>`
                + `<path d="M7 21h10"/>`
                + `<path d="M7 3c0 4 5 5 5 9s-5 5-5 9"/>`
                + `<path d="M17 3c0 4-5 5-5 9s5 5 5 9"/>`;

/** ✅ 圆形对勾（成功 / 已复制） */
const CHECK_CIRCLE = `<circle cx="12" cy="12" r="9"/>`
                  + `<path d="M8 12.2L11 15.2 16.2 9.6"/>`;

/** ⚠️ 警告三角 */
const WARNING_TRI = `<path d="M12 4L21 19H3L12 4Z"/>`
                  + `<path d="M12 10v4"/>`
                  + `<circle cx="12" cy="17" r="0.6" fill="currentColor"/>`;

/** ⚠ 单线警告 (短) */
const WARNING_LINE = `<circle cx="12" cy="12" r="9"/>`
                   + `<path d="M12 7v6"/>`
                   + `<circle cx="12" cy="16" r="0.6" fill="currentColor"/>`;

/** ✓ 简单对勾（小，正/官方版本） */
const CHECK_SIMPLE = `<path d="M5 12.5L10 17 19 7.5"/>`;

/** ✗ 叉号（不匹配） */
const CROSS_SIMPLE = `<path d="M6 6l12 12M18 6L6 18"/>`;

/* === 麦克风图标族（说话人 badge） ============================ */
/**
 * 🎙 麦克风（带支架，工作室麦克风风格）
 * 用于：每个 entry 的说话人 badge 前缀
 * 受 .spk-badge 字号约束，size 默认 11
 */
const MIC_STUDIO = `<rect x="9" y="3" width="6" height="11" rx="3"/>`
                 + `<path d="M5.5 11a6.5 6.5 0 0 0 13 0"/>`
                 + `<path d="M12 17.5v3"/>`
                 + `<path d="M9 20.5h6"/>`;

/* === 主题切换图标（已有，保持兼容） ========================== */
const THEME_MOON = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" `
                 + `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" `
                 + `stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" fill="white"/></svg>`;
const THEME_SUN  = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" `
                 + `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" `
                 + `stroke-linejoin="round"><circle cx="12" cy="12" r="5" fill="white"/>`
                 + `<line x1="12" y1="1" x2="12" y2="3" stroke-width="2.8"/>`
                 + `<line x1="12" y1="21" x2="12" y2="23" stroke-width="2.8"/>`
                 + `<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke-width="2.8"/>`
                 + `<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke-width="2.8"/>`
                 + `<line x1="1" y1="12" x2="3" y2="12" stroke-width="2.8"/>`
                 + `<line x1="21" y1="12" x2="23" y2="12" stroke-width="2.8"/>`
                 + `<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke-width="2.8"/>`
                 + `<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke-width="2.8"/></svg>`;

/* === 音量图标（已有，保持） ================================ */
const VOL_NORMAL = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
                 + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">`
                 + `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>`
                 + `<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`
                 + `<path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
const VOL_MUTED  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
                 + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">`
                 + `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>`
                 + `<line x1="22" y1="9" x2="16" y2="15"/>`
                 + `<line x1="16" y1="9" x2="22" y2="15"/></svg>`;

/* === 公开接口 =============================================== */
window.ICONS = {
  // 主要替换 emoji 的图标（用 svg() 包装，可指定 size）
  folderOpen: (size = 14) => svg(FOLDER_OPEN, {size, style:'flex-shrink:0'}),
  save:       (size = 14) => svg(SAVE,        {size, style:'flex-shrink:0'}),
  filePlus:   (size = 14) => svg(FILE_PLUS,   {size, style:'flex-shrink:0'}),
  copy:       (size = 13) => svg(COPY,        {size, style:'flex-shrink:0;vertical-align:-2px'}),
  folderDown: (size = 13) => svg(FOLDER_DOWN, {size, style:'flex-shrink:0;vertical-align:-2px'}),
  hourglass:  (size = 12) => svg(HOURGLASS,   {size, style:'flex-shrink:0;vertical-align:-2px'}),
  checkCircle:(size = 13) => svg(CHECK_CIRCLE,{size, style:'flex-shrink:0;vertical-align:-2px'}),
  warning:    (size = 12) => svg(WARNING_TRI, {size, style:'flex-shrink:0;vertical-align:-2px'}),
  warningLine:(size = 12) => svg(WARNING_LINE,{size, style:'flex-shrink:0;vertical-align:-2px'}),
  checkSmall: (size = 12) => svg(CHECK_SIMPLE,{size, style:'flex-shrink:0;vertical-align:-2px'}),
  crossSmall: (size = 12) => svg(CROSS_SIMPLE,{size, style:'flex-shrink:0;vertical-align:-2px'}),
  micStudio:  (size = 11) => svg(MIC_STUDIO,  {size, style:'flex-shrink:0;vertical-align:-1px'}),

  // 主题/音量（保持原本字符串变量名）
  THEME_MOON, THEME_SUN,
  VOL_NORMAL, VOL_MUTED,
};

})();
