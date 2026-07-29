'use strict';

// ここにalt：コンテンツスクリプト本体
// 対象要素（img / role="img"）を検出し、選択中の表示モードで置き換える。

const COCONI_ALT_DEFAULTS = {
  enabled: true,
  mode: 'panel',
  fontSize: 16,
  color: '#1A1A1A',
  backgroundColor: '#F2F2F2',
  borderColor: '#949494',
  borderWidth: 1,
  panelOpacity: 100,
  emptyAltBehavior: 'display-none',
  missingAltBehavior: 'show',
  backgroundImageBehavior: 'hide',
  excludedDomains: []
};

const MARKER_ATTR = 'data-coconi-alt-processed';
const BG_MARKER_ATTR = 'data-coconi-alt-bg-processed';
const REPLACEMENT_CLASS = 'coconi-alt-replacement';

let settings = { ...COCONI_ALT_DEFAULTS };
let observer = null;

// 置き換え済み要素の記録（解除時に元へ戻すため）
// { original, replacement, inlineDisplay, inlineVisibility }
let records = [];

function isExcludedDomain() {
  const hostname = location.hostname.toLowerCase();
  if (!hostname) {
    return false;
  }
  return settings.excludedDomains.some((entry) => {
    const domain = String(entry).trim().toLowerCase();
    if (!domain) {
      return false;
    }
    return hostname === domain || hostname.endsWith(`.${domain}`);
  });
}

function applyThemeVars(node) {
  node.style.setProperty('--coconi-alt-font-size', `${settings.fontSize}px`);
  node.style.setProperty('--coconi-alt-color', settings.color);
  node.style.setProperty('--coconi-alt-bg', settings.backgroundColor);
  node.style.setProperty('--coconi-alt-border-width', `${settings.borderWidth}px`);
  node.style.setProperty('--coconi-alt-border-color', settings.borderColor);
}

// 元要素は非表示にした後だと寸法が取れないため、一時的に表示状態へ戻して同期的に測る
function measureOriginal(record) {
  const el = record.original;
  const currentDisplay = el.style.display;
  el.style.display = record.inlineDisplay;
  const rect = el.getBoundingClientRect();
  el.style.display = currentDisplay;
  return rect;
}

function setPanelSize(panel, record) {
  const rect = measureOriginal(record);
  if (rect.width > 0) {
    panel.style.setProperty('--coconi-alt-width', `${rect.width}px`);
  }
  if (rect.height > 0) {
    panel.style.setProperty('--coconi-alt-height', `${rect.height}px`);
  }
}

function hexToRgba(hex, alpha) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) {
    return hex;
  }
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function relativeLuminance(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) {
    return 0;
  }
  const value = parseInt(match[1], 16);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((value >> 16) & 255)
    + 0.7152 * channel((value >> 8) & 255)
    + 0.0722 * channel(value & 255);
}

// img は画像そのもの、video は poster（再生前サムネイル）のURLを返す。
// video に poster が無い場合、フレームをキャプチャする手段はCORSで失敗しやすく
// 信頼性が低いため何もしない
function getUnderlayImageUrl(el) {
  if (el.tagName === 'IMG') {
    return el.currentSrc || el.src || '';
  }
  if (el.tagName === 'VIDEO') {
    return el.poster || '';
  }
  return '';
}

// 不透明度が100未満のとき、元画像（またはvideoのposter）をパネルの下敷きレイヤーとして表示する
// （altチェック用途向け。画像URLをCSS背景として敷くため、未ロードの遅延画像でも表示できる）
function setPanelUnderlay(panel, el) {
  if (settings.panelOpacity >= 100) {
    return;
  }
  const src = getUnderlayImageUrl(el);
  if (src) {
    panel.style.setProperty('--coconi-alt-underlay', `url("${src.replace(/"/g, '\\"')}")`);
  }
}

function createPanel(text, record) {
  // 空テキストのパネルは展開操作に意味がないため、フォーカス不能な span にする
  const isInteractive = text.length > 0;
  const panel = document.createElement(isInteractive ? 'button' : 'span');
  panel.className = `${REPLACEMENT_CLASS} coconi-alt-panel`;
  panel.textContent = text;
  if (isInteractive) {
    panel.type = 'button';
    panel.setAttribute('aria-expanded', 'false');
    panel.addEventListener('click', () => {
      const expanded = panel.classList.toggle('coconi-alt-panel-expanded');
      panel.setAttribute('aria-expanded', String(expanded));
    });
  }
  applyThemeVars(panel);
  if (settings.panelOpacity < 100) {
    panel.style.setProperty('--coconi-alt-bg', hexToRgba(settings.backgroundColor, settings.panelOpacity / 100));
    // 透けた画像の上でも文字の輪郭が立つよう、前景色の輝度に応じて
    // 白/黒を選んだ4方向ハローを付ける
    const halo = relativeLuminance(settings.color) > 0.5 ? '#000000' : '#FFFFFF';
    panel.style.setProperty(
      '--coconi-alt-text-shadow',
      `1px 1px 0 ${halo}, -1px 1px 0 ${halo}, 1px -1px 0 ${halo}, -1px -1px 0 ${halo}`
    );
  }
  return panel;
}

function createTextFixed(text) {
  const span = document.createElement('span');
  span.className = `${REPLACEMENT_CLASS} coconi-alt-text-fixed`;
  span.textContent = text;
  applyThemeVars(span);
  return span;
}

function createTextInherit(text) {
  const span = document.createElement('span');
  span.className = `${REPLACEMENT_CLASS} coconi-alt-text-inherit`;
  span.textContent = text;
  return span;
}

// AIによる推測（試験的機能）：service workerに生成を依頼し、
// 返ってきたテキストで置き換え要素の内容を差し替える
const AI_PREFIX = 'AIによる推測: ';
const AI_PENDING_TEXT = 'AIによる推測を生成中…';

function requestAiAltText(img, record) {
  const url = img.currentSrc || img.src || '';
  const showFallback = (reason) => {
    if (record.replacement && record.replacement.isConnected) {
      record.replacement.textContent = reason ? `AIによる推測を利用できません（${reason}）: ${url}` : url;
    }
  };
  if (!url) {
    showFallback('');
    return;
  }
  try {
    chrome.runtime.sendMessage({ type: 'coconi-alt-generate-alt', url }, (response) => {
      if (chrome.runtime.lastError || !response) {
        showFallback(chrome.runtime.lastError ? chrome.runtime.lastError.message : '応答なし');
        return;
      }
      if (!record.replacement || !record.replacement.isConnected) {
        return;
      }
      if (response.ok && response.text) {
        record.replacement.textContent = AI_PREFIX + response.text;
      } else {
        showFallback(response.error || '不明なエラー');
      }
    });
  } catch (error) {
    showFallback(String(error && error.message ? error.message : error));
  }
}

// behavior: 'show' | 'display-none' | 'visibility-hidden'
function applyBehavior(el, text, behavior) {
  const record = {
    original: el,
    replacement: null,
    inlineDisplay: el.style.display,
    inlineVisibility: el.style.visibility
  };
  el.setAttribute(MARKER_ATTR, '');

  if (behavior === 'display-none') {
    el.style.display = 'none';
  } else if (behavior === 'visibility-hidden') {
    el.style.visibility = 'hidden';
  } else {
    let replacement;
    if (settings.mode === 'text-fixed') {
      replacement = createTextFixed(text);
    } else if (settings.mode === 'text-inherit') {
      replacement = createTextInherit(text);
    } else {
      replacement = createPanel(text, record);
    }
    el.style.display = 'none';
    el.insertAdjacentElement('afterend', replacement);
    record.replacement = replacement;

    if (settings.mode === 'panel') {
      setPanelSize(replacement, record);
      if (el.tagName === 'IMG') {
        setPanelUnderlay(replacement, el);
        // 未ロード画像は寸法・currentSrcが確定していないため、ロード完了後に反映し直す
        if (!el.complete) {
          el.addEventListener('load', () => {
            setPanelSize(replacement, record);
            setPanelUnderlay(replacement, el);
          }, { once: true });
        }
      } else if (el.tagName === 'VIDEO') {
        setPanelUnderlay(replacement, el);
      }
    }
  }

  records.push(record);
  return record;
}

function processImg(img) {
  if (!img.hasAttribute('alt')) {
    if (settings.missingAltBehavior === 'ai') {
      const record = applyBehavior(img, AI_PENDING_TEXT, 'show');
      if (record.replacement) {
        record.replacement.classList.add('coconi-alt-ai');
      }
      requestAiAltText(img, record);
    } else {
      const src = img.currentSrc || img.src || '';
      applyBehavior(img, src, settings.missingAltBehavior);
    }
  } else if (img.getAttribute('alt') === '') {
    applyBehavior(img, '', settings.emptyAltBehavior);
  } else {
    applyBehavior(img, img.getAttribute('alt'), 'show');
  }
}

// <video> にはalt属性が無いため、非対応ブラウザ向けのフォールバックコンテンツ
// （<source>・<track> を除く子ノードのテキスト）を代替テキストとして扱う
function getVideoFallbackText(video) {
  let text = '';
  video.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'SOURCE' && node.tagName !== 'TRACK') {
      text += node.textContent;
    }
  });
  return text.replace(/\s+/g, ' ').trim();
}

function getVideoSrc(video) {
  if (video.currentSrc || video.src) {
    return video.currentSrc || video.src;
  }
  const source = video.querySelector('source[src]');
  return source ? source.src : '';
}

function processVideo(video) {
  const fallback = getVideoFallbackText(video);
  if (fallback) {
    applyBehavior(video, fallback, 'show');
    return;
  }
  // フォールバックコンテンツが無い場合はalt属性なしの設定に準じるが、
  // AIによる推測は画像単体を前提とした機能のため動画には適用せず、
  // src表示にフォールバックする
  const behavior = settings.missingAltBehavior === 'ai' ? 'show' : settings.missingAltBehavior;
  const text = behavior === 'show' ? getVideoSrc(video) : '';
  applyBehavior(video, text, behavior);
}

function processRoleImg(el) {
  const label = el.getAttribute('aria-label');
  if (!label) {
    return;
  }
  applyBehavior(el, label, 'show');
}

// CSS背景画像（url() を含むもの）を非表示にする。
// role="img" 等の置き換え対象にならない背景画像は、スクリーンリーダーに
// 知覚されない「見た目だけの情報」なので、耳で見ている世界には存在しない。
// グラデーションのみの背景は画像ではないため対象外。
function processBackgroundImage(el) {
  if (el.hasAttribute(BG_MARKER_ATTR) || el.hasAttribute(MARKER_ATTR)) {
    return;
  }
  if (el.closest(`.${REPLACEMENT_CLASS}`)) {
    return;
  }
  if (el.parentElement && el.parentElement.closest(`[${MARKER_ATTR}]`)) {
    return;
  }
  const backgroundImage = getComputedStyle(el).backgroundImage;
  if (backgroundImage === 'none' || !backgroundImage.includes('url(')) {
    return;
  }
  const record = {
    original: el,
    replacement: null,
    kind: 'bg',
    inlineBackgroundImage: el.style.getPropertyValue('background-image'),
    inlineBackgroundPriority: el.style.getPropertyPriority('background-image')
  };
  el.setAttribute(BG_MARKER_ATTR, '');
  el.style.setProperty('background-image', 'none', 'important');
  records.push(record);
}

function processElement(el) {
  if (el.hasAttribute(MARKER_ATTR)) {
    return;
  }
  // 自前の置き換え要素の中や、処理済み要素（role="img" 内の img 等）の中は対象外
  if (el.closest(`.${REPLACEMENT_CLASS}`)) {
    return;
  }
  if (el.parentElement && el.parentElement.closest(`[${MARKER_ATTR}]`)) {
    return;
  }
  if (el.tagName === 'IMG') {
    processImg(el);
  } else if (el.tagName === 'VIDEO') {
    processVideo(el);
  } else if (el.getAttribute('role') === 'img') {
    processRoleImg(el);
  }
}

const REPLACEABLE_SELECTOR = 'img, video, [role="img"]';

function processTree(root) {
  if (root.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  // 置き換え（img / video / role="img"）を先に処理してから背景画像を走査する。
  // 置き換え済みサブツリー内の背景画像はマーカー判定でスキップされる。
  if (root.matches(REPLACEABLE_SELECTOR)) {
    processElement(root);
  }
  root.querySelectorAll(REPLACEABLE_SELECTOR).forEach(processElement);

  if (settings.backgroundImageBehavior === 'hide') {
    processBackgroundImage(root);
    root.querySelectorAll('*').forEach(processBackgroundImage);
  }
}

// ページ側のDOM変化で元要素・置き換え要素が消えた記録を掃除する
function pruneRecords() {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (!record.original.isConnected) {
      if (record.replacement) {
        record.replacement.remove();
      }
      records.splice(i, 1);
    } else if (record.replacement && !record.replacement.isConnected) {
      restoreRecord(record);
      records.splice(i, 1);
    }
  }
}

// 一部のサイトは video の poster 属性を要素追加後に非同期でセットする。
// 既に置き換え済みの video で poster が後から付いた場合、パネルの下敷きに反映し直す
function handlePosterAttributeChange(video) {
  if (settings.mode !== 'panel' || settings.panelOpacity >= 100) {
    return;
  }
  const record = records.find((r) => r.original === video);
  if (record && record.replacement) {
    setPanelUnderlay(record.replacement, video);
  }
}

function startObserver() {
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') {
        if (mutation.target.tagName === 'VIDEO') {
          handlePosterAttributeChange(mutation.target);
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }
        if (node.classList.contains(REPLACEMENT_CLASS)) {
          continue;
        }
        processTree(node);
      }
    }
    pruneRecords();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['poster']
  });
}

function restoreRecord(record) {
  const el = record.original;
  if (record.kind === 'bg') {
    if (record.inlineBackgroundImage) {
      el.style.setProperty('background-image', record.inlineBackgroundImage, record.inlineBackgroundPriority);
    } else {
      el.style.removeProperty('background-image');
    }
    el.removeAttribute(BG_MARKER_ATTR);
    return;
  }
  el.style.display = record.inlineDisplay;
  el.style.visibility = record.inlineVisibility;
  el.removeAttribute(MARKER_ATTR);
  if (record.replacement) {
    record.replacement.remove();
  }
}

function teardown() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  records.forEach(restoreRecord);
  records = [];
}

function refresh() {
  teardown();
  if (!settings.enabled || isExcludedDomain()) {
    return;
  }
  processTree(document.documentElement);
  startObserver();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') {
    return;
  }
  for (const [key, change] of Object.entries(changes)) {
    if (key in settings) {
      settings[key] = change.newValue ?? COCONI_ALT_DEFAULTS[key];
    }
  }
  refresh();
});

chrome.storage.sync.get(COCONI_ALT_DEFAULTS).then((stored) => {
  settings = stored;
  refresh();
});
