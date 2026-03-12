const toggle = document.getElementById('toggle');
const appidInput = document.getElementById('appid');
const secretInput = document.getElementById('secret');
const saveBtn = document.getElementById('save');
const statusEl = document.getElementById('status');

function setStatus(msg, ok = true) {
  statusEl.textContent = msg || '';
  statusEl.style.color = ok ? '#0b8a00' : '#c0392b';
}

// 读取当前状态和配置
chrome.storage.sync.get(['enabled', 'baiduAppId', 'baiduSecret'], result => {
  toggle.checked = result.enabled !== false; // 默认开启
  if (result.baiduAppId) appidInput.value = result.baiduAppId;
  if (result.baiduSecret) secretInput.value = result.baiduSecret;
});

// 启用开关
toggle.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: toggle.checked });
});

// 保存百度翻译配置
saveBtn.addEventListener('click', () => {
  const appid = appidInput.value.trim();
  const secret = secretInput.value.trim();

  if (!appid || !secret) {
    setStatus('APPID 和密钥都不能为空。', false);
    return;
  }

  saveBtn.disabled = true;
  setStatus('正在保存...', true);

  chrome.storage.sync.set(
    {
      baiduAppId: appid,
      baiduSecret: secret
    },
    () => {
      saveBtn.disabled = false;
      setStatus('已保存。刷新课程页面后生效。', true);
    }
  );
});

