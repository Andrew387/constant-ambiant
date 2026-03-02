import * as Tone from 'tone';

/**
 * Loads an audio buffer from a URL and applies time-stretching,
 * smart auto-gain normalization, and effects to create an ambient texture layer.
 */

/**
 * Analyzes a Tone.ToneAudioBuffer and returns a suggested gain offset in dB
 * to normalize it to a target RMS level.
 *
 * @param {Tone.ToneAudioBuffer} buffer
 * @param {number} [targetRmsDb=-18] - Target RMS level in dB
 * @returns {number} Gain offset in dB to apply
 */
function computeAutoGain(buffer, targetRmsDb = -18) {
  const data = buffer.getChannelData(0);
  const sampleCount = Math.min(data.length, 44100 * 30); // analyze up to 30s

  // Use both RMS and peak to catch loud transients
  let sumSquares = 0;
  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    const abs = Math.abs(data[i]);
    sumSquares += data[i] * data[i];
    if (abs > peak) peak = abs;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));
  const peakDb = 20 * Math.log10(Math.max(peak, 1e-10));

  const gainOffset = targetRmsDb - rmsDb;

  // Also check: don't let peaks exceed -6 dBFS after gain
  const peakAfterGain = peakDb + gainOffset;
  const peakLimited = peakAfterGain > -6 ? gainOffset - (peakAfterGain + 6) : gainOffset;

  // Tight clamp: max +12 dB boost (was +30), max -20 dB cut
  const clamped = Math.max(-20, Math.min(12, peakLimited));
  return clamped;
}

/**
 * Loads an audio buffer and creates an 800% time-stretched version
 * by playing it at 1/8 speed using Tone.GrainPlayer.
 * Applies smart auto-gain normalization based on source RMS level.
 *
 * @param {string} url - URL of the audio file
 * @param {Tone.ToneAudioNode} destination - Node to connect to
 * @returns {Promise<object|null>} The player/filter/reverb, or null on failure
 */
export async function processArchiveAudio(url, destination) {
  let player, highpass, filter, reverb;
  try {
    player = new Tone.GrainPlayer({
      url,
      loop: true,
      grainSize: 0.5,
      overlap: 0.15,
      playbackRate: 0.125, // 800% time-stretch (1/8 speed)
      volume: 0, // will be set by auto-gain after loading
    });

    // High-pass filter to cut the lows
    highpass = new Tone.Filter({
      type: 'highpass',
      frequency: 250,
      Q: 0.5,
    });

    // Low-pass filter to soften the stretched audio (raised to let more highs through)
    filter = new Tone.Filter({
      type: 'lowpass',
      frequency: 3500,
      Q: 0.5,
    });

    // Add reverb (longer decay, wetter mix)
    reverb = new Tone.Reverb({
      decay: 14,
      wet: 0.85,
    });
    await reverb.generate();

    player.connect(highpass);
    highpass.connect(filter);
    filter.connect(reverb);
    reverb.connect(destination);

    // Wait for the buffer to load
    await Tone.loaded();

    // Apply smart auto-gain normalization
    if (player.buffer && player.buffer.length > 0) {
      const gainOffset = computeAutoGain(player.buffer, -24);
      player.volume.value = gainOffset;
    } else {
      player.volume.value = -6;
    }
    return { player, highpass, filter, reverb };
  } catch (err) {
    console.error('[archive] error loading audio:', err);
    try { if (player) player.dispose(); } catch {}
    try { if (highpass) highpass.dispose(); } catch {}
    try { if (filter) filter.dispose(); } catch {}
    try { if (reverb) reverb.dispose(); } catch {}
    return null;
  }
}
