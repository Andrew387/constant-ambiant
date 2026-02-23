/**
 * Minimal UI controls: play/stop toggle, master volume.
 * No framework — plain DOM manipulation.
 */

/**
 * Creates and mounts the UI controls.
 *
 * @param {object} callbacks
 * @param {Function} callbacks.onStart - Called when play is pressed
 * @param {Function} callbacks.onStop - Called when stop is pressed
 * @param {Function} callbacks.onVolumeChange - Called with volume value (0–1)
 */
export function createControls({ onStart, onStop, onVolumeChange }) {
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

  // Mount
  container.appendChild(playBtn);
  container.appendChild(volumeGroup);
}
