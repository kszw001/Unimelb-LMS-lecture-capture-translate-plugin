const TRANSCRIPT_CONTAINER_SELECTOR = '.transcript-list';
const LINE_SELECTOR = 'dd[data-test-component="Content"]';

const translationCache = new Map(); // srcText → zhText
let subtitleEl = null;
let currentSrcText = '';
let retryCount = 0;
const MAX_RETRY = 20;
const CC_POS_KEY = 'ccPosition';

function loadCCPosition() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get([CC_POS_KEY], r => resolve(r?.[CC_POS_KEY] || null));
    } catch { resolve(null); }
  });
}

function saveCCPosition(top, left) {
  try { chrome.storage.sync.set({ [CC_POS_KEY]: { top, left } }); } catch {}
}

// ===== 找到视频播放器容器 =====
// 从 <video> 元素向上找第一个足够大的祖先，作为字幕的宿主元素。
// 字幕注入到播放器容器内部，全屏时会跟着一起进入全屏，无需额外处理。
function findPlayerContainer() {
  const video = document.querySelector('video');
  if (!video) return null;
  let el = video.parentElement;
  while (el && el !== document.body) {
    const rect = el.getBoundingClientRect();
    if (rect.width >= 400 && rect.height >= 300) return el;
    el = el.parentElement;
  }
  return null;
}

// ===== 字幕 DOM 元素 =====
function ensureSubtitleEl() {
  if (subtitleEl && subtitleEl.isConnected) return subtitleEl;

  subtitleEl = document.createElement('div');
  subtitleEl.id = 'melbuni-cc-zh';
  Object.assign(subtitleEl.style, {
    position: 'absolute',
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

  const parent = findPlayerContainer() || document.body;
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  parent.appendChild(subtitleEl);

  makeDraggable(subtitleEl, parent);

  // 恢复上次保存的位置
  loadCCPosition().then(pos => {
    if (!pos || !subtitleEl) return;
    subtitleEl.style.transform = 'none';
    subtitleEl.style.bottom = 'auto';
    subtitleEl.style.top = `${pos.top}px`;
    subtitleEl.style.left = `${pos.left}px`;
  });

  return subtitleEl;
}

// ===== 拖拽逻辑 =====
function makeDraggable(el, parent) {
  let dragging = false;
  let startX, startY, startLeft, startTop;

  el.addEventListener('pointerdown', e => {
    dragging = true;
    el.setPointerCapture(e.pointerId);

    // 将当前视觉位置转换成相对于 parent 的 top/left，
    // 去掉 bottom 和 transform，统一用 top/left 定位
    const parentRect = parent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    startTop = elRect.top - parentRect.top;
    startLeft = elRect.left - parentRect.left;

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
    const newTop = startTop + (e.clientY - startY);
    const newLeft = startLeft + (e.clientX - startX);

    // 限制在 parent 范围内
    const parentRect = parent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const clampedTop = Math.max(0, Math.min(newTop, parentRect.height - elRect.height));
    const clampedLeft = Math.max(0, Math.min(newLeft, parentRect.width - elRect.width));

    el.style.top = `${clampedTop}px`;
    el.style.left = `${clampedLeft}px`;
  });

  el.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    const parentRect = parent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    saveCCPosition(
      Math.round(elRect.top - parentRect.top),
      Math.round(elRect.left - parentRect.left),
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
async function updateCurrentCaption(container) {
  const activeWrapper = container.querySelector('div[tabindex="0"]');
  if (!activeWrapper) { hideSubtitle(); return; }

  const activeSpan = activeWrapper.querySelector(`${LINE_SELECTOR} span`);
  if (!activeSpan) { hideSubtitle(); return; }

  const srcText = activeSpan.innerText.trim();
  if (!srcText) { hideSubtitle(); return; }

  // 字幕没变就不重复翻译
  if (srcText === currentSrcText) return;
  currentSrcText = srcText;

  // 缓存命中，直接显示
  if (translationCache.has(srcText)) {
    showSubtitle(translationCache.get(srcText));
    return;
  }

  // 等待翻译期间先显示原文，避免字幕闪烁消失
  showSubtitle(srcText);

  const zh = await translateToChinese(srcText);
  const display = (zh && zh !== srcText) ? zh : srcText;
  translationCache.set(srcText, display);
  // 确认字幕还是这句话（避免翻译回来时已切换到下一句）
  if (currentSrcText === srcText) showSubtitle(display);
}

// ===== 监听字幕 DOM 变化 =====
function setupTranscriptObserver(container) {
  const observer = new MutationObserver(() => updateCurrentCaption(container));
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'tabindex'],
  });
  updateCurrentCaption(container);
}

// ===== 初始化（带重试）=====
function initWhenEnabled() {
  const container = document.querySelector(TRANSCRIPT_CONTAINER_SELECTOR);
  if (!container) {
    if (retryCount < MAX_RETRY) {
      retryCount += 1;
      if (retryCount <= 3) {
        console.warn('[MelbUni Subtitle Translator] 未找到字幕容器，2 秒后重试');
      }
      setTimeout(initWhenEnabled, 2000);
    } else if (retryCount === MAX_RETRY) {
      retryCount += 1;
      console.warn('[MelbUni Subtitle Translator] 多次未找到字幕容器，停止重试');
    }
    return;
  }

  console.log('[MelbUni Subtitle Translator] 找到字幕容器，开始监听');
  ensureSubtitleEl();
  setupTranscriptObserver(container);
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
