import * as Tone from 'tone';

/**
 * Creates a ping-pong delay with tempo-synced delay time and filtered feedback.
 *
 * @returns {Tone.PingPongDelay}
 */
export function createDelay() {
  const delay = new Tone.PingPongDelay({
    delayTime: '4n.',  // dotted quarter note, tempo-synced
    feedback: 0.35,
    wet: 0.25,
    maxDelay: 4,
  });
  return delay;
}
