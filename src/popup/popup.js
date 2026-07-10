'use strict';

const DEFAULTS = {
  enabled: true,
  mode: 'panel'
};

const enabledInput = document.getElementById('enabled');
const modeInputs = document.querySelectorAll('input[name="mode"]');

async function restore() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  enabledInput.checked = stored.enabled;
  modeInputs.forEach((input) => {
    input.checked = input.value === stored.mode;
  });
}

enabledInput.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledInput.checked });
});

modeInputs.forEach((input) => {
  input.addEventListener('change', () => {
    if (input.checked) {
      chrome.storage.sync.set({ mode: input.value });
    }
  });
});

document.getElementById('open-options').addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

restore();
