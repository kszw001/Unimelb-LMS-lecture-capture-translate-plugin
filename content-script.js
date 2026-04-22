const TRANSCRIPT_CONTAINER_SELECTOR = '.transcript-list';
const LINE_SELECTOR = 'dd[data-test-component="Content"]';

const translationCache = new Map(); // srcText → zhText
let subtitleEl = null;
let currentSrcText = '';
let transcriptObserver = null; // 当前绑定的字幕容器 MutationObserver
let lastKnownContainer = null; // 最后一次见到的字幕容器（即使被卸载仍保留引用）
const CC_POS_KEY = 'ccPosition';

function loadCCPosition() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get([CC_POS_KEY], r => resolve(r?.[CC_POS_KEY] || null));
    } catch { resolve(null); }
  });
}

// 位置以百分比存储（相对播放器容器宽高），全屏与非全屏共用同一套比例
function saveCCPosition(topPct, leftPct) {
  try { chrome.storage.sync.set({ [CC_POS_KEY]: { top: topPct, left: leftPct, v: 2 } }); } catch {}
}

// ===== 字幕 DOM 元素 =====
// 始终使用 position:fixed（相对视口），绝不修改任何父元素的样式。
// 全屏时通过 fullscreenchange 把字幕移入全屏元素，fixed 在全屏元素内
// 会相对全屏视口定位，行为一致。
function ensureSubtitleEl() {
  if (subtitleEl && subtitleEl.isConnected) return subtitleEl;

  subtitleEl = document.createElement('div');
  subtitleEl.id = 'melbuni-cc-zh';
  Object.assign(subtitleEl.style, {
    position: 'fixed',
    bottom: '90px',
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: '80%',
    background: 'rgba(0,0,0,0.78)',
    color: '#fff',
    padding: '5px 14px',
    borderRadius: '4px',
    fontSize: '16px',
    lineHeight: '1.5',
    textAlign: 'center',
    zIndex: '2147483647',
    cursor: 'move',
    fontFamily: '-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
    display: 'none',
    whiteSpace: 'pre-wrap',
    userSelect: 'none',
  });

  document.body.appendChild(subtitleEl);
  makeDraggable(subtitleEl);

  // 全屏：把字幕移入全屏元素，使其在全屏模式下可见
  document.addEventListener('fullscreenchange', () => {
    if (!subtitleEl) return;
    const fsEl = document.fullscreenElement;
    if (fsEl) {
      fsEl.appendChild(subtitleEl);
    } else {
      document.body.appendChild(subtitleEl);
    }
  });

  // 恢复上次保存的位置（v:2 表示视口百分比格式）
  loadCCPosition().then(pos => {
    if (!pos || pos.v !== 2 || !subtitleEl) return;
    subtitleEl.style.transform = 'none';
    subtitleEl.style.bottom = 'auto';
    subtitleEl.style.top = `${pos.top}%`;
    subtitleEl.style.left = `${pos.left}%`;
  });

  return subtitleEl;
}

// ===== 拖拽逻辑 =====
// 使用视口坐标（clientX/Y），position:fixed 的定位基准始终是视口，
// 全屏时视口即为全屏元素，计算方式相同，无需区分两种模式。
function makeDraggable(el) {
  let dragging = false;
  let startX, startY, startLeft, startTop;

  el.addEventListener('pointerdown', e => {
    dragging = true;
    el.setPointerCapture(e.pointerId);

    const elRect = el.getBoundingClientRect();
    // 记录当前视口相对位置，去掉 bottom/transform，统一用 top/left
    startTop = elRect.top;
    startLeft = elRect.left;
    el.style.transform = 'none';
    el.style.bottom = 'auto';
    el.style.top = `${startTop}px`;
    el.style.left = `${startLeft}px`;

    startX = e.clientX;
    startY = e.clientY;
    e.preventDefault();
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const elRect = el.getBoundingClientRect();
    const newTop = startTop + (e.clientY - startY);
    const newLeft = startLeft + (e.clientX - startX);

    // 限制在视口范围内，存为视口百分比
    const clampedTop = Math.max(0, Math.min(newTop, vh - elRect.height));
    const clampedLeft = Math.max(0, Math.min(newLeft, vw - elRect.width));
    el.style.top = `${(clampedTop / vh * 100).toFixed(2)}%`;
    el.style.left = `${(clampedLeft / vw * 100).toFixed(2)}%`;
  });

  el.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const elRect = el.getBoundingClientRect();
    saveCCPosition(
      elRect.top / vh * 100,
      elRect.left / vw * 100,
    );
  });
}

// ===== 显示 / 隐藏 =====
function showSubtitle(text) {
  const el = ensureSubtitleEl();
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

function hideSubtitle() {
  if (subtitleEl) subtitleEl.style.display = 'none';
}

// ===== 翻译（通过后台调用百度 API）=====
async function translateToChinese(text) {
  if (!text || !text.trim()) return '';
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type: 'TRANSLATE_TO_ZH', text }, response => {
        if (chrome.runtime.lastError) { resolve(''); return; }
        resolve((response && response.translatedText) || '');
      });
    } catch { resolve(''); }
  });
}

// ===== 检测当前正在播放的字幕行并翻译 =====
// 把前一行拼在一起发给 API（用 \n 分隔），利用上下文改善短句翻译质量，
// 只取最后一行的翻译结果作为当前字幕展示。
let prevSrcText = '';

async function updateCurrentCaption(container) {
  const activeWrapper = container.querySelector('div[tabindex="0"]');
  if (!activeWrapper) { hideSubtitle(); return; }

  const activeSpan = activeWrapper.querySelector(`${LINE_SELECTOR} span`);
  if (!activeSpan) { hideSubtitle(); return; }

  const srcText = activeSpan.innerText.trim();
  if (!srcText) { hideSubtitle(); return; }

  if (srcText === currentSrcText) return;
  const prev = currentSrcText;
  currentSrcText = srcText;

  // 缓存命中，直接显示
  if (translationCache.has(srcText)) {
    prevSrcText = srcText;
    showSubtitle(translationCache.get(srcText));
    return;
  }

  hideSubtitle();

  // 把上一句作为上下文拼入请求，帮助 API 理解句子结构
  const query = prev ? `${prev}\n${srcText}` : srcText;
  const raw = await translateToChinese(query);

  // 取最后一行（对应 srcText 的翻译）
  const zh = raw ? raw.split('\n').pop().trim() : '';
  const display = (zh && zh !== srcText) ? zh : srcText;
  translationCache.set(srcText, display);
  prevSrcText = srcText;

  if (currentSrcText === srcText) showSubtitle(display);
}

// ===== 预翻译后台队列 =====
// 对当前 transcript DOM 里可见的所有未翻译行做后台预翻译，
// 等字幕播放到时直接从缓存读取，消除空白等待。
let prefetchTimerId = null;
let prefetchAbort = false;

function schedulePrefetch(container) {
  // 每次 DOM 变化后重置计时器，避免与当前字幕的实时翻译请求撞车
  clearTimeout(prefetchTimerId);
  prefetchAbort = true;
  prefetchTimerId = setTimeout(() => {
    prefetchAbort = false;
    runPrefetch(container);
  }, 1500);
}

async function runPrefetch(container) {
  const lines = [...container.querySelectorAll(LINE_SELECTOR)];
  for (const line of lines) {
    if (prefetchAbort) return;
    const span = line.querySelector('span');
    if (!span) continue;
    const text = span.innerText.trim();
    if (!text || translationCache.has(text)) continue;

    // 单行翻译填充缓存（无需上下文，只要提前存好即可）
    const zh = await translateToChinese(text);
    if (!prefetchAbort) {
      translationCache.set(text, (zh && zh !== text) ? zh : text);
    }
    // 遵守百度免费版 1 QPS 限制
    await new Promise(r => setTimeout(r, 1200));
  }
}

// ===== 监听字幕 DOM 变化 =====
function setupTranscriptObserver(container) {
  lastKnownContainer = container; // 始终保留最新容器引用

  // 先断开旧的观察器，避免重复绑定
  if (transcriptObserver) {
    transcriptObserver.disconnect();
    transcriptObserver = null;
  }

  transcriptObserver = new MutationObserver(() => {
    updateCurrentCaption(container);
    schedulePrefetch(container);
  });
  transcriptObserver.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'tabindex'],
  });
  updateCurrentCaption(container);
  schedulePrefetch(container);
}

// ===== 顶层文档观察器：监听字幕容器的挂载与重新挂载 =====
// Echo360 切换右侧面板（字幕 ↔ 幻灯片）时，React 会卸载/重新挂载
// .transcript-list，这里监听其出现，自动重新绑定，无需用户手动切换。
function setupDocumentObserver() {
  let boundContainer = null;
  let debounceTimer = null;

  const docObserver = new MutationObserver(() => {
    // 防抖：React 应用每次渲染会产生大量 DOM 变化，合并成一次检查
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const container = document.querySelector(TRANSCRIPT_CONTAINER_SELECTOR);
      if (container && container !== boundContainer) {
        boundContainer = container;
        console.log('[MelbUni Subtitle Translator] 字幕容器已就绪，重新绑定');
        setupTranscriptObserver(container);
      }
    }, 300);
  });

  // 只监听子节点增删（childList），不监听属性
  docObserver.observe(document.body, { childList: true, subtree: true });
}

// ===== video timeupdate 心跳 =====
// 只要视频在播放，每 500ms 主动查一次当前字幕。
// 这样即使切换到 Notes 面板导致 .transcript-list 被卸载、MutationObserver
// 失效，只要字幕容器还在 DOM 里（哪怕被隐藏），翻译就能持续工作。
function setupVideoHeartbeat() {
  const tryBind = () => {
    const video = document.querySelector('video');
    if (!video) { setTimeout(tryBind, 2000); return; }

    let lastTick = 0;
    video.addEventListener('timeupdate', () => {
      const now = Date.now();
      if (now - lastTick < 500) return;
      lastTick = now;
      const container = document.querySelector(TRANSCRIPT_CONTAINER_SELECTOR);
      if (container) updateCurrentCaption(container);
    });
  };
  tryBind();
}

// ===== 初始化 =====
function initWhenEnabled() {
  ensureSubtitleEl();

  // 1. 顶层观察器：处理字幕容器重新挂载（面板切回字幕时重新绑定 observer）
  setupDocumentObserver();

  // 2. 视频心跳：面板切走后 MutationObserver 失效时的兜底保障
  setupVideoHeartbeat();

  // 3. 如果容器已经在 DOM 里，立即绑定
  const container = document.querySelector(TRANSCRIPT_CONTAINER_SELECTOR);
  if (container) {
    console.log('[MelbUni Subtitle Translator] 字幕容器已就绪，开始监听');
    setupTranscriptObserver(container);
  }
}

// ===== 读取开关状态 =====
function bootstrap() {
  if (!chrome?.storage?.sync) { initWhenEnabled(); return; }
  chrome.storage.sync.get(['enabled'], result => {
    if (result.enabled === false) {
      console.log('[MelbUni Subtitle Translator] 已关闭翻译');
      return;
    }
    initWhenEnabled();
  });
}

bootstrap();
