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

function setRadioValue(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === value;
  });
}

function getRadioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

async function restore() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  fontSizeInput.value = stored.fontSize;
  colorInput.value = stored.color;
  backgroundColorInput.value = stored.backgroundColor;
  borderColorInput.value = stored.borderColor;
  borderWidthInput.value = stored.borderWidth;
  panelOpacityInput.value = stored.panelOpacity;
  setRadioValue('empty-alt', stored.emptyAltBehavior);
  setRadioValue('missing-alt', stored.missingAltBehavior);
  setRadioValue('background-image', stored.backgroundImageBehavior);
  excludedDomainsInput.value = stored.excludedDomains.join('\n');
}

function parseExcludedDomains(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line !== '');
}

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

restore();
