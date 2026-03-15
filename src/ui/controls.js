/**
 * Minimal UI controls: play/stop toggle, master volume,
 * lead/bass instrument selectors.
 * No framework — plain DOM manipulation.
 */

import {
  LEAD_INSTRUMENTS, BASS_INSTRUMENTS, BASS_LEAD_INSTRUMENTS, DEFAULT_LEAD, DEFAULT_BASS,
} from '../audio/synths/sampleRegistry.js';

/**
 * Creates and mounts the UI controls.
 *
 * @param {object} callbacks
 * @param {Function} callbacks.onStart - Called when play is pressed
 * @param {Function} callbacks.onStop - Called when stop is pressed
 * @param {Function} callbacks.onVolumeChange - Called with volume value (0–1)
 * @param {Function} callbacks.onLeadChange - Called with instrument ID
 * @param {Function} callbacks.onBassChange - Called with instrument ID
 */
export function createControls({ onStart, onStop, onVolumeChange, onLeadChange, onBassChange }) {
  const container = document.getElementById('controls');
  if (!container) return;

  let isPlaying = false;

  // Play/Stop button
  const playBtn = document.createElement('button');
  playBtn.id = 'play-btn';
  playBtn.textContent = 'Start';
  playBtn.addEventListener('click', () => {
    if (!isPlaying) {
      onStart();
      playBtn.textContent = 'Stop';
      playBtn.classList.add('active');
      isPlaying = true;
    } else {
      onStop();
      playBtn.textContent = 'Start';
      playBtn.classList.remove('active');
      isPlaying = false;
    }
  });

  // Volume slider
  const volumeGroup = document.createElement('div');
  volumeGroup.className = 'control-group';

  const volumeLabel = document.createElement('label');
  volumeLabel.textContent = 'Volume';
  volumeLabel.htmlFor = 'volume-slider';

  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.id = 'volume-slider';
  volumeSlider.min = '0';
  volumeSlider.max = '100';
  volumeSlider.value = '70';
  volumeSlider.addEventListener('input', () => {
    onVolumeChange(Number(volumeSlider.value) / 100);
  });

  volumeGroup.appendChild(volumeLabel);
  volumeGroup.appendChild(volumeSlider);

  // ── Instrument selectors ──

  const leadGroup = buildInstrumentGroup('Lead', [...LEAD_INSTRUMENTS, ...BASS_LEAD_INSTRUMENTS], DEFAULT_LEAD, (id) => {
    if (onLeadChange) onLeadChange(id);
  });

  const bassGroup = buildInstrumentGroup('Bass', [...BASS_INSTRUMENTS, ...BASS_LEAD_INSTRUMENTS], DEFAULT_BASS, (id) => {
    if (onBassChange) onBassChange(id);
  });

  // Mount
  container.appendChild(playBtn);
  container.appendChild(volumeGroup);
  container.appendChild(leadGroup);
  container.appendChild(bassGroup);
}

/**
 * Builds a row of radio-style toggle buttons for an instrument group.
 */
function buildInstrumentGroup(label, instruments, defaultId, onChange) {
  const group = document.createElement('div');
  group.className = 'instrument-group';

  const groupLabel = document.createElement('label');
  groupLabel.textContent = label;
  group.appendChild(groupLabel);

  const buttons = [];

  for (const inst of instruments) {
    const btn = document.createElement('button');
    btn.className = 'instrument-btn';
    btn.textContent = inst.name;
    btn.dataset.instrumentId = inst.id;

    if (inst.id === defaultId) {
      btn.classList.add('active');
    }

    btn.addEventListener('click', () => {
      // Deactivate all in this group
      for (const b of buttons) b.classList.remove('active');
      btn.classList.add('active');
      onChange(inst.id);
    });

    buttons.push(btn);
    group.appendChild(btn);
  }

  return group;
}
