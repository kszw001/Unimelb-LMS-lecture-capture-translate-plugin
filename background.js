// 背景 Service Worker：负责跨域调用翻译 API（百度翻译）

import { md5 as md5Utf8 } from './md5.js';

// 所有用户自己的 APPID / 密钥都保存在 chrome.storage.sync 中，不写死在代码里
const CONFIG_KEYS = ['baiduAppId', 'baiduSecret'];

function getBaiduConfig() {
  return new Promise(resolve => {
    try {
      chrome.storage.sync.get(CONFIG_KEYS, result => {
        resolve({
          appid: result.baiduAppId || '',
          secret: result.baiduSecret || ''
        });
      });
    } catch (e) {
      console.warn('插件读取百度配置失败', e);
      resolve({ appid: '', secret: '' });
    }
  });
}

async function callTranslateAPI(text) {
  if (!text || !text.trim()) return '';

  const { appid, secret } = await getBaiduConfig();
  if (!appid || !secret) {
    console.warn('插件尚未配置百度翻译 APPID/密钥，请在插件设置中填写。');
    return text;
  }

  try {
    const salt = String(Date.now());
    const sign = md5Utf8(appid + text + salt + secret);

    const params = new URLSearchParams();
    params.set('q', text);
    params.set('from', 'auto');
    params.set('to', 'zh');
    params.set('appid', appid);
    params.set('salt', salt);
    params.set('sign', sign);

    const resp = await fetch('https://fanyi-api.baidu.com/api/trans/vip/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!resp.ok) {
      console.error('Baidu Translate API error', resp.status);
      return text;
    }

    const data = await resp.json();
    if (data.error_code) {
      console.error('Baidu Translate API error_code', data.error_code, data.error_msg);
      return text;
    }

    if (Array.isArray(data.trans_result) && data.trans_result.length > 0) {
      return data.trans_result.map(item => item.dst).join('\n');
    }

    return text;
  } catch (err) {
    console.error('Translate API exception', err && err.name, err && err.message);
    return text;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'TRANSLATE_TO_ZH') {
    (async () => {
      const translatedText = await callTranslateAPI(message.text || '');
      sendResponse({ translatedText });
    })();
    // 异步响应
    return true;
  }
});

