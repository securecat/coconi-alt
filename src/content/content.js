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
  emptyAltBehavior: 'display-none',
  missingAltBehavior: 'show',
  excludedDomains: []
};

const MARKER_ATTR = 'data-coconi-alt-processed';
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
      // 未ロード画像は寸法が確定していないため、ロード完了後に測り直す
      if (el.tagName === 'IMG' && !el.complete) {
        el.addEventListener('load', () => setPanelSize(replacement, record), { once: true });
      }
    }
  }

  records.push(record);
}

function processImg(img) {
  if (!img.hasAttribute('alt')) {
    const src = img.currentSrc || img.src || '';
    applyBehavior(img, src, settings.missingAltBehavior);
  } else if (img.getAttribute('alt') === '') {
    applyBehavior(img, '', settings.emptyAltBehavior);
  } else {
    applyBehavior(img, img.getAttribute('alt'), 'show');
  }
}

function processRoleImg(el) {
  const label = el.getAttribute('aria-label');
  if (!label) {
    return;
  }
  applyBehavior(el, label, 'show');
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
  } else if (el.getAttribute('role') === 'img') {
    processRoleImg(el);
  }
}

function processTree(root) {
  if (root.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  if (root.matches('img, [role="img"]')) {
    processElement(root);
  }
  root.querySelectorAll('img, [role="img"]').forEach(processElement);
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

function startObserver() {
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
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
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function restoreRecord(record) {
  const el = record.original;
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
