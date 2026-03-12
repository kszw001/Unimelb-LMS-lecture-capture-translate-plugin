const TRANSCRIPT_CONTAINER_SELECTOR = '.transcript-list'; // 字幕/文字整体容器
const LINE_SELECTOR = 'dd[data-test-component="Content"]'; // 每一行英文字幕（只选 dd，不会选到 Speaker 名称）

let overlayContainer = null;
const seenSubtitleLines = new Set();
const lineRowMap = new Map();
let currentActiveRow = null;
let retryCount = 0;
const MAX_RETRY = 20; 
const OVERLAY_POS_KEY = 'overlayPosition';

function loadOverlayPosition() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get([OVERLAY_POS_KEY], result => {
        resolve(result && result[OVERLAY_POS_KEY] ? result[OVERLAY_POS_KEY] : null);
      });
    } catch {
      resolve(null);
    }
  });
}

function saveOverlayPosition(pos) {
  try {
    chrome.storage.sync.set({ [OVERLAY_POS_KEY]: pos });
  } catch {
    // ignore
  }
}

function ensureOverlayContainer() {
  if (overlayContainer && document.body.contains(overlayContainer)) {
    return overlayContainer;
  }

  const container = document.createElement('div');
  container.id = 'melbuni-subtitle-overlay';
  container.style.position = 'fixed';
  container.style.right = '8px';
  container.style.top = '80px';
  container.style.width = '360px';
  container.style.maxWidth = '40vw';
  container.style.height = '60vh';
  container.style.background = 'rgba(255,255,255,0.96)';
  container.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
  container.style.borderRadius = '8px';
  container.style.zIndex = '9999';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.overflow = 'hidden';
  container.style.fontFamily = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';
  container.style.fontSize = '13px';

  const header = document.createElement('div');
  header.textContent = '字幕中英对照（🉑拖动）';
  header.style.padding = '6px 10px';
  header.style.background = '#005c9d';
  header.style.color = '#fff';
  header.style.fontSize = '12px';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.cursor = 'move';
  header.style.userSelect = 'none';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.border = 'none';
  closeBtn.style.background = 'transparent';
  closeBtn.style.color = '#fff';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '14px';
  closeBtn.style.lineHeight = '1';
  closeBtn.onclick = () => {
    container.style.display = 'none';
  };

  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.id = 'melbuni-subtitle-overlay-body';
  body.style.flex = '1 1 auto';
  body.style.overflowY = 'auto';
  body.style.padding = '8px 10px';

  container.appendChild(header);
  container.appendChild(body);

  document.body.appendChild(container);
  overlayContainer = container;

  // 恢复上次位置（如果有）
  loadOverlayPosition().then(pos => {
    if (!pos) return;
    container.style.left = `${pos.left}px`;
    container.style.top = `${pos.top}px`;
    container.style.right = 'auto';
  });

  // 拖拽逻辑：拖动标题栏
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onPointerMove = e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newLeft = startLeft + dx;
    const newTop = startTop + dy;

    container.style.left = `${newLeft}px`;
    container.style.top = `${newTop}px`;
    container.style.right = 'auto';
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);

    const rect = container.getBoundingClientRect();
    saveOverlayPosition({ left: Math.round(rect.left), top: Math.round(rect.top) });
  };

  header.addEventListener('pointerdown', e => {
    // 点击关闭按钮不触发拖拽
    if (e.target === closeBtn) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = container.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });

  return container;
}

function highlightActiveRow(row, body) {
  if (!row || !body) return;
  if (currentActiveRow && body.contains(currentActiveRow)) {
    currentActiveRow.style.background = '';
  }
  currentActiveRow = row;
  currentActiveRow.style.background = '#e8f3ff';
}

function updateActiveOverlayPosition(container) {
  const overlay = ensureOverlayContainer();
  const body = overlay.querySelector('#melbuni-subtitle-overlay-body');
  if (!body) return;

  // 当前正在播放的字幕所在行：外层 div 的 tabindex="0"
  const activeWrapper = container.querySelector('div[tabindex="0"]');
  if (!activeWrapper) return;
  const activeSpan = activeWrapper.querySelector('dd[data-test-component="Content"] span');
  if (!activeSpan) return;

  const activeText = activeSpan.innerText.trim();
  if (!activeText) return;

  const row = lineRowMap.get(activeText);
  if (!row || !body.contains(row)) return;

  // 把当前行移动到列表底部，并高亮
  body.appendChild(row);
  highlightActiveRow(row, body);
  body.scrollTop = body.scrollHeight;
}

// ===== 翻译函数（通过后台调用真实翻译 API）=====
// UI 已经确认正常，这里改回通过 background.js 调用在线翻译服务。
async function translateTextToChinese(text) {
  if (!text || !text.trim()) return '';

  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(
        { type: 'TRANSLATE_EN_ZH', text },
        response => {
          if (chrome.runtime.lastError) {
            console.error('[MelbUni Subtitle Translator] translate message error', chrome.runtime.lastError);
            // 失败时退回原文，至少不空
            resolve(text);
            return;
          }
          const zh = (response && response.translatedText) || '';
          resolve(zh || text);
        }
      );
    } catch (err) {
      console.error('[MelbUni Subtitle Translator] translateTextToChinese exception', err);
      resolve(text);
    }
  });
}

// ===== 翻译并渲染一批字幕行 =====
async function translateExistingLines(container) {
  const lines = container.querySelectorAll(LINE_SELECTOR);
  const overlay = ensureOverlayContainer();
  const body = overlay.querySelector('#melbuni-subtitle-overlay-body');

  for (const line of lines) {
    if (line.dataset.translatedToZh === 'true') continue;

    const span = line.querySelector('span');
    if (!span) continue;

    const englishText = span.innerText.trim();
    if (!englishText) continue;

    // 由于 Echo 的字幕列表是虚拟滚动实现，滚动时会重新创建 DOM，
    // 同一句话会多次出现在 DOM 中，这里用文本去重，避免悬浮框里重复很多次。
    if (seenSubtitleLines.has(englishText)) {
      line.dataset.translatedToZh = 'true';
      continue;
    }
    seenSubtitleLines.add(englishText);

    const zh = await translateTextToChinese(englishText);
    if (!zh) continue;

    const row = document.createElement('div');
    row.style.marginBottom = '8px';
    row.style.paddingBottom = '6px';
    row.style.borderBottom = '1px solid #eee';

    const enDiv = document.createElement('div');
    enDiv.textContent = englishText;
    enDiv.style.color = '#333';
    enDiv.style.marginBottom = '2px';

    const zhDiv = document.createElement('div');
    zhDiv.textContent = zh;
    zhDiv.style.color = '#00b894';

    row.appendChild(enDiv);
    row.appendChild(zhDiv);

    body.appendChild(row);
    lineRowMap.set(englishText, row);

    line.dataset.translatedToZh = 'true';
  }

  // 每次翻译完一批行后，根据当前播放位置调整悬浮框最后一行
  updateActiveOverlayPosition(container);
}

// ===== 监听字幕 DOM 变化，翻译新增内容 =====
function setupTranscriptObserver(container) {
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        if (node.matches && node.matches(LINE_SELECTOR)) {
          translateExistingLines(container);
        }

        const innerLines = node.querySelectorAll ? node.querySelectorAll(LINE_SELECTOR) : [];
        if (innerLines.length > 0) {
          translateExistingLines(container);
        }
      }
    }

    // 监听到 DOM 改变后，更新当前播放位置对应的悬浮框行
    updateActiveOverlayPosition(container);
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'tabindex']
  });

  // 初始翻译一遍现有字幕
  translateExistingLines(container);
}

function initWhenEnabled() {
  const container = document.querySelector(TRANSCRIPT_CONTAINER_SELECTOR);
  if (!container) {
    // 页面可能还没完全加载好，稍后重试；同时设置最大重试次数，避免无限循环
    if (retryCount < MAX_RETRY) {
      retryCount += 1;
      if (retryCount <= 3) {
        // 只在前几次打印日志，避免刷屏
        console.warn('[MelbUni Subtitle Translator] 未找到字幕容器，2 秒后重试');
      }
      setTimeout(initWhenEnabled, 2000);
    } else if (retryCount === MAX_RETRY) {
      retryCount += 1;
      console.warn('[MelbUni Subtitle Translator] 多次未找到字幕容器，停止重试');
    }
    setTimeout(initWhenEnabled, 2000);
    return;
  }

  console.log('[MelbUni Subtitle Translator] 找到字幕容器，开始监听和翻译');
  setupTranscriptObserver(container);
}

// ===== 读取开关状态，决定是否启用翻译 =====
function bootstrap() {
  if (!chrome || !chrome.storage || !chrome.storage.sync) {
    // 理论上在 MV3 里一定存在，这里只是防御性判断
    initWhenEnabled();
    return;
  }

  chrome.storage.sync.get(['enabled'], result => {
    const enabled = result.enabled !== false; // 默认开启
    if (!enabled) {
      console.log('[MelbUni Subtitle Translator] 已关闭翻译');
      return;
    }
    initWhenEnabled();
  });
}

bootstrap();

