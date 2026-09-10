'use strict';

const DEFAULTS = {
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

const form = document.getElementById('options-form');
const fontSizeInput = document.getElementById('font-size');
const colorInput = document.getElementById('color');
const backgroundColorInput = document.getElementById('background-color');
const borderColorInput = document.getElementById('border-color');
const borderWidthInput = document.getElementById('border-width');
const panelOpacityInput = document.getElementById('panel-opacity');
const excludedDomainsInput = document.getElementById('excluded-domains');
const statusOutput = document.getElementById('status');
const shortcutStatusOutput = document.getElementById('shortcut-status');
const openShortcutsLink = document.getElementById('open-shortcuts');

const TOGGLE_ENABLED_COMMAND = 'toggle-enabled';

function setRadioValue(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === value;
  });
}

function getRadioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

// 見た目設定セクションの入力欄に値を流し込む（保存はしない）
function fillAppearance(values) {
  fontSizeInput.value = values.fontSize;
  colorInput.value = values.color;
  backgroundColorInput.value = values.backgroundColor;
  borderColorInput.value = values.borderColor;
  borderWidthInput.value = values.borderWidth;
}

async function restore() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  fillAppearance(stored);
  panelOpacityInput.value = stored.panelOpacity;
  setRadioValue('empty-alt', stored.emptyAltBehavior);
  setRadioValue('missing-alt', stored.missingAltBehavior);
  setRadioValue('background-image', stored.backgroundImageBehavior);
  excludedDomainsInput.value = stored.excludedDomains.join('\n');
}

async function updateShortcutStatus() {
  const commands = await chrome.commands.getAll();
  const command = commands.find((item) => item.name === TOGGLE_ENABLED_COMMAND);
  const shortcut = command ? command.shortcut : '';

  shortcutStatusOutput.textContent = '';
  if (shortcut) {
    shortcutStatusOutput.append('ここにaltモードの有効/無効切替は');
    const code = document.createElement('code');
    code.textContent = shortcut;
    shortcutStatusOutput.append(code);
    shortcutStatusOutput.append('に割り当てられています。変更するにはChromeのショートカット設定を開いてください。');
  } else {
    shortcutStatusOutput.textContent =
      'ここにaltモードの有効/無効切替にショートカットキーを割り当てることができます。現在は未設定です。';
  }
}

openShortcutsLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ショートカット設定ページで変更してからこのタブに戻ってきた際に反映するため、
// ウィンドウにフォーカスが戻るたび最新の割り当てを読み直す
window.addEventListener('focus', updateShortcutStatus);

function parseExcludedDomains(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '');
}

document.getElementById('reset-appearance').addEventListener('click', () => {
  fillAppearance(DEFAULTS);
  clearStatus();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await chrome.storage.sync.set({
    fontSize: Number(fontSizeInput.value) || DEFAULTS.fontSize,
    color: colorInput.value,
    backgroundColor: backgroundColorInput.value,
    borderColor: borderColorInput.value,
    borderWidth: Math.max(0, Number(borderWidthInput.value) || 0),
    panelOpacity: Math.min(100, Math.max(0, Number(panelOpacityInput.value) || 0)),
    emptyAltBehavior: getRadioValue('empty-alt') || DEFAULTS.emptyAltBehavior,
    missingAltBehavior: getRadioValue('missing-alt') || DEFAULTS.missingAltBehavior,
    backgroundImageBehavior: getRadioValue('background-image') || DEFAULTS.backgroundImageBehavior,
    excludedDomains: parseExcludedDomains(excludedDomainsInput.value)
  });
  statusOutput.textContent = '設定を保存しました。開いているページには即時反映されます。';
});

// 保存メッセージはユーザーの操作起因で消す：
// ウィンドウのフォーカスが外れたとき、またはフォームコントロールを操作した
// （＝入力内容が保存済みの状態から変わり始めた）とき
function clearStatus() {
  statusOutput.textContent = '';
}

window.addEventListener('blur', clearStatus);
form.addEventListener('input', clearStatus);

restore();
updateShortcutStatus();
