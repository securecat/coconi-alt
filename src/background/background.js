'use strict';

// ここにalt：「有効にする」設定に応じたツールバーアイコンの切り替え
const ACTION_ICONS = {
  on: { 16: 'icons/icon16.png', 32: 'icons/icon32.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
  off: { 16: 'icons/icon16-off.png', 32: 'icons/icon32-off.png', 48: 'icons/icon48-off.png', 128: 'icons/icon128-off.png' }
};

function updateActionIcon(enabled) {
  chrome.action.setIcon({ path: enabled ? ACTION_ICONS.on : ACTION_ICONS.off });
}

chrome.storage.sync.get({ enabled: true }, (stored) => {
  updateActionIcon(stored.enabled);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, 'enabled')) {
    updateActionIcon(changes.enabled.newValue);
  }
});

// ここにalt：AIによる代替テキスト生成（試験的機能）
// Chrome内蔵AI（Prompt API + Gemini Nano）を使い、alt属性のない画像の
// 代替テキストを画像単体から生成する。処理はすべて端末内で完結し、
// 画像が外部に送信されることはない。

const PROMPT_TEXT =
  'これはWebページ上の画像です。この画像のalt属性として使える、簡潔な日本語の代替テキストを1文だけ書いてください。'
  + '前置き・引用符・箇条書きは不要で、説明文のみを出力してください。';

// 同一URLの再生成を避けるキャッシュ（service workerが生きている間のみ）
const cache = new Map();

// Gemini Nanoへの問い合わせは直列化する（並列実行による負荷・失敗を避ける）
let queueTail = Promise.resolve();

async function ensureAvailability() {
  if (typeof LanguageModel === 'undefined') {
    throw new Error('この環境ではChrome内蔵AI（Prompt API）を利用できません');
  }
  const availability = await LanguageModel.availability({
    expectedInputs: [{ type: 'image' }]
  });
  if (availability === 'unavailable') {
    throw new Error('この環境ではAIの画像入力を利用できません（対応ハードウェア・フラグ設定を確認してください）');
  }
  return availability;
}

// 画像を取得してImageBitmap化する。大きすぎる画像は縮小する。
// SVG等でビットマップ化できない場合はBlobのまま返す
async function fetchImageForPrompt(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`画像の取得に失敗しました（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  try {
    const bitmap = await createImageBitmap(blob);
    const MAX_EDGE = 1024;
    if (bitmap.width > MAX_EDGE || bitmap.height > MAX_EDGE) {
      const scale = MAX_EDGE / Math.max(bitmap.width, bitmap.height);
      const resized = await createImageBitmap(bitmap, {
        resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
        resizeHeight: Math.max(1, Math.round(bitmap.height * scale))
      });
      bitmap.close();
      return resized;
    }
    return bitmap;
  } catch (error) {
    return blob;
  }
}

async function generateOnce(url) {
  await ensureAvailability();
  const image = await fetchImageForPrompt(url);
  let session = null;
  try {
    session = await LanguageModel.create({
      expectedInputs: [{ type: 'image' }]
    });
    const result = await session.prompt([
      {
        role: 'user',
        content: [
          { type: 'text', value: PROMPT_TEXT },
          { type: 'image', value: image }
        ]
      }
    ]);
    const text = String(result).trim();
    if (!text) {
      throw new Error('AIから空の応答が返されました');
    }
    return text;
  } finally {
    if (session) {
      session.destroy();
    }
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) {
      image.close();
    }
  }
}

function generateAltText(url) {
  if (cache.has(url)) {
    return Promise.resolve(cache.get(url));
  }
  const task = queueTail
    .catch(() => {})
    .then(async () => {
      if (cache.has(url)) {
        return cache.get(url);
      }
      const text = await generateOnce(url);
      cache.set(url, text);
      return text;
    });
  queueTail = task.catch(() => {});
  return task;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'coconi-alt-generate-alt' && typeof message.url === 'string') {
    generateAltText(message.url)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));
    return true;
  }
  return false;
});
