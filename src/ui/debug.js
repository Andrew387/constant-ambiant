import * as Tone from 'tone';

let meters = {};
let analyser = null;
let animFrameId = null;
let canvas = null;
let canvasCtx = null;
let paramChangeHandler = null;

/**
 * Creates the debug panel UI with toggle button, spectrum placeholder,
 * track level meters, parameter sliders, and archive status.
 * Can be called before audio is initialized.
 *
 * @param {object} options
 * @param {Function} options.onParamChange - Called with (param, value)
 * @param {Function} options.getConfig - Returns current engine config
 */
export function createDebugPanel({ onParamChange, getConfig }) {
  paramChangeHandler = onParamChange;

  const panel = document.createElement('div');
  panel.id = 'debug-panel';

  // Toggle button
  const toggle = document.createElement('button');
  toggle.id = 'debug-toggle';
  toggle.textContent = 'Debug';
  toggle.addEventListener('click', () => {
    panel.classList.toggle('open');
  });
  document.body.appendChild(toggle);

  // --- Spectrum Analyzer ---
  const analyserSection = document.createElement('div');
  analyserSection.className = 'debug-section';

  const analyserLabel = document.createElement('div');
  analyserLabel.className = 'debug-section-label';
  analyserLabel.textContent = 'Spectrum';
  analyserSection.appendChild(analyserLabel);

  canvas = document.createElement('canvas');
  canvas.id = 'spectrum-canvas';
  canvas.width = 300;
  canvas.height = 120;
  analyserSection.appendChild(canvas);
  canvasCtx = canvas.getContext('2d');

  // Draw empty spectrum
  canvasCtx.fillStyle = '#0a0a0f';
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

  panel.appendChild(analyserSection);

  // --- Per-track Level Meters ---
  const metersSection = document.createElement('div');
  metersSection.className = 'debug-section';

  const metersLabel = document.createElement('div');
  metersLabel.className = 'debug-section-label';
  metersLabel.textContent = 'Track Levels';
  metersSection.appendChild(metersLabel);

  const trackNames = ['pad', 'drone', 'lead', 'archive', 'freesound', 'sampleTexture'];
  const trackDisplayNames = { sampleTexture: 'smpTxtr' };
  trackNames.forEach(name => {
    const row = document.createElement('div');
    row.className = 'meter-row';

    const label = document.createElement('span');
    label.className = 'meter-label';
    label.textContent = trackDisplayNames[name] || name;

    const meterBg = document.createElement('div');
    meterBg.className = 'meter-bg';

    const meterFill = document.createElement('div');
    meterFill.className = 'meter-fill';
    meterFill.id = `meter-${name}`;

    const meterValue = document.createElement('span');
    meterValue.className = 'meter-value';
    meterValue.id = `meter-val-${name}`;
    meterValue.textContent = '-∞ dB';

    meterBg.appendChild(meterFill);
    row.appendChild(label);
    row.appendChild(meterBg);
    row.appendChild(meterValue);
    metersSection.appendChild(row);
  });

  panel.appendChild(metersSection);

  // --- Effects Toggle ---
  const effectsSection = document.createElement('div');
  effectsSection.className = 'debug-section';

  const effectsLabel = document.createElement('div');
  effectsLabel.className = 'debug-section-label';
  effectsLabel.textContent = 'Effects';
  effectsSection.appendChild(effectsLabel);

  const effectsRow = document.createElement('div');
  effectsRow.className = 'param-row';

  const effectsToggleLabel = document.createElement('label');
  effectsToggleLabel.textContent = 'Reverb / Delay / Filter';
  effectsToggleLabel.htmlFor = 'param-effects-enabled';

  const effectsToggle = document.createElement('input');
  effectsToggle.type = 'checkbox';
  effectsToggle.id = 'param-effects-enabled';
  effectsToggle.checked = false;
  effectsToggle.addEventListener('change', () => {
    onParamChange('effectsEnabled', effectsToggle.checked);
  });

  effectsRow.appendChild(effectsToggleLabel);
  effectsRow.appendChild(effectsToggle);
  effectsSection.appendChild(effectsRow);
  panel.appendChild(effectsSection);

  // --- Live Parameter Sliders ---
  const paramsSection = document.createElement('div');
  paramsSection.className = 'debug-section';

  const paramsLabel = document.createElement('div');
  paramsLabel.className = 'debug-section-label';
  paramsLabel.textContent = 'Parameters';
  paramsSection.appendChild(paramsLabel);

  const config = getConfig();

  const sliders = [
    { id: 'chord-interval', label: 'Chord Length (measures)', param: 'chordDuration', min: 0.25, max: 3, step: 0.25, value: config.chordDuration },
    { id: 'attack', label: 'Attack', param: 'attackLevel', min: 0, max: 1.5, step: 0.05, value: config.attackLevel || 1.0 },
    { id: 'release', label: 'Release', param: 'releaseLevel', min: 0, max: 1.5, step: 0.05, value: config.releaseLevel || 1.0 },
    { id: 'pad-vol', label: 'Pad Volume', param: 'padVolume', min: 0, max: 1, step: 0.05, value: 0.45 },
    { id: 'drone-vol', label: 'Drone Volume', param: 'droneVolume', min: 0, max: 1, step: 0.05, value: 0.5 },
    { id: 'lead-vol', label: 'Lead Volume', param: 'leadVolume', min: 0, max: 1, step: 0.05, value: 0.4 },
    { id: 'archive-vol', label: 'Archive Volume', param: 'archiveVolume', min: 0, max: 1, step: 0.05, value: 0.7 },
    { id: 'freesound-vol', label: 'Freesound Volume', param: 'freesoundVolume', min: 0, max: 1, step: 0.05, value: 0.4 },
    { id: 'sample-texture-vol', label: 'Sample Texture Volume', param: 'sampleTextureVolume', min: 0, max: 1, step: 0.05, value: 0.35 },
  ];

  sliders.forEach(s => {
    const row = document.createElement('div');
    row.className = 'param-row';

    const label = document.createElement('label');
    label.textContent = s.label;
    label.htmlFor = `param-${s.id}`;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'param-value';
    valueSpan.id = `param-val-${s.id}`;
    valueSpan.textContent = s.value;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = `param-${s.id}`;
    slider.min = s.min;
    slider.max = s.max;
    slider.step = s.step;
    slider.value = s.value;
    slider.addEventListener('input', () => {
      const val = Number(slider.value);
      valueSpan.textContent = val;
      onParamChange(s.param, val);
    });

    row.appendChild(label);
    row.appendChild(slider);
    row.appendChild(valueSpan);
    paramsSection.appendChild(row);
  });

  panel.appendChild(paramsSection);

  // --- Archive Status ---
  const archiveSection = document.createElement('div');
  archiveSection.className = 'debug-section';

  const archiveLabel = document.createElement('div');
  archiveLabel.className = 'debug-section-label';
  archiveLabel.textContent = 'Archive Status';
  archiveSection.appendChild(archiveLabel);

  const archiveStatus = document.createElement('div');
  archiveStatus.id = 'archive-status';
  archiveStatus.textContent = 'Waiting...';
  archiveSection.appendChild(archiveStatus);

  panel.appendChild(archiveSection);

  // --- Freesound Status ---
  const freesoundSection = document.createElement('div');
  freesoundSection.className = 'debug-section';

  const freesoundLabel = document.createElement('div');
  freesoundLabel.className = 'debug-section-label';
  freesoundLabel.textContent = 'Freesound Status';
  freesoundSection.appendChild(freesoundLabel);

  const freesoundStatus = document.createElement('div');
  freesoundStatus.id = 'freesound-status';
  freesoundStatus.textContent = 'Waiting...';
  freesoundSection.appendChild(freesoundStatus);

  panel.appendChild(freesoundSection);

  document.body.appendChild(panel);
}

/**
 * Connects audio nodes to the debug panel (spectrum analyser + track meters).
 * Call this after the audio context and mixer are initialized.
 *
 * @param {object} trackEffects - { pad, drone, lead, ... } effect groups with .output nodes
 */
export function connectDebugAudio(trackEffects) {
  // Create analyser node on master output
  analyser = new Tone.Analyser('fft', 256);
  Tone.getDestination().connect(analyser);

  // Create a Tone.Meter for each track, connected post-effects
  const meterTrackNames = ['pad', 'drone', 'lead', 'archive', 'freesound', 'sampleTexture'];
  meterTrackNames.forEach(name => {
    if (trackEffects[name]) {
      const meter = new Tone.Meter({ smoothing: 0.8 });
      trackEffects[name].output.connect(meter);
      meters[name] = meter;
    }
  });

  // Start animation loop
  startAnimation();
}

function startAnimation() {
  function draw() {
    animFrameId = requestAnimationFrame(draw);

    // Update spectrum
    if (analyser && canvasCtx && canvas) {
      const values = analyser.getValue();
      canvasCtx.fillStyle = '#0a0a0f';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      // Use logarithmic frequency mapping so mids/highs are visible
      // FFT bin i corresponds to frequency: i * (sampleRate / fftSize)
      // We map log(freq) to canvas x-position
      const sampleRate = Tone.getContext().sampleRate || 44100;
      const fftSize = 256;
      const numBins = values.length; // 128 bins
      const minFreq = sampleRate / fftSize;         // ~172 Hz (bin 1)
      const maxFreq = sampleRate / 2;               // ~22050 Hz (Nyquist)
      const logMin = Math.log10(minFreq);
      const logMax = Math.log10(maxFreq);
      const numBars = 64; // fewer, wider bars for clarity
      const barWidth = canvas.width / numBars;

      for (let bar = 0; bar < numBars; bar++) {
        // Map bar position to frequency range (log scale)
        const t = bar / numBars;
        const tNext = (bar + 1) / numBars;
        const freqLo = Math.pow(10, logMin + t * (logMax - logMin));
        const freqHi = Math.pow(10, logMin + tNext * (logMax - logMin));

        // Find which FFT bins fall in this frequency range and average them
        const binLo = Math.max(1, Math.floor(freqLo / (sampleRate / fftSize)));
        const binHi = Math.min(numBins - 1, Math.ceil(freqHi / (sampleRate / fftSize)));
        let sumDb = 0;
        let count = 0;
        for (let b = binLo; b <= binHi; b++) {
          sumDb += values[b];
          count++;
        }
        const db = count > 0 ? sumDb / count : -100;

        // Compressed dB range: -70 to -10 mapped to 0–1 (ambient music is quiet)
        const norm = Math.max(0, Math.min(1, (db + 70) / 60));
        const height = norm * canvas.height;

        // Color: warm coral → gold → cyan → violet, bright and saturated
        const hue = 10 + t * 270;
        const saturation = 75 + norm * 20;    // 75-95%
        const lightness = 30 + norm * 40;     // 30-70%
        canvasCtx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.95)`;
        canvasCtx.fillRect(bar * barWidth, canvas.height - height, barWidth - 1, height);
      }
    }

    // Update per-track meters
    for (const [name, meter] of Object.entries(meters)) {
      const level = meter.getValue();
      const db = typeof level === 'number' ? level : -Infinity;
      const fill = document.getElementById(`meter-${name}`);
      const valEl = document.getElementById(`meter-val-${name}`);
      if (fill && valEl) {
        // Map dB to percentage (range: -60 to 0)
        const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
        fill.style.width = `${pct}%`;
        fill.style.backgroundColor = pct > 80 ? '#e85d3a' : pct > 50 ? '#d4a926' : '#3ac4e8';
        valEl.textContent = db > -100 ? `${db.toFixed(1)} dB` : '-∞ dB';
      }
    }
  }

  draw();
}

/**
 * Updates the archive status display.
 * @param {string} status
 */
export function updateArchiveStatus(status) {
  const el = document.getElementById('archive-status');
  if (el) el.innerText = status;
}

/**
 * Updates the freesound status display.
 * @param {string} status
 */
export function updateFreesoundStatus(status) {
  const el = document.getElementById('freesound-status');
  if (el) el.innerText = status;
}

export function disposeDebugPanel() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  if (analyser) analyser.dispose();
  for (const m of Object.values(meters)) m.dispose();
  meters = {};
}
