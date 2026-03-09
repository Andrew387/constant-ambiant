/**
 * Node ID allocator for SuperCollider synths.
 *
 * scsynth requires unique integer node IDs for every synth instance.
 * This module provides a simple monotonic allocator that avoids
 * collision with the reserved group IDs used by startup.scd.
 *
 * Reserved ranges:
 *   0        — default group (scsynth built-in)
 *   99       — bus clear group (runs first each cycle)
 *   100–115  — source groups
 *   200      — effects group
 *   300      — reverb group
 *   400      — master group
 *
 * We start allocating from 1000 and go up. With 32-bit signed ints
 * we have ~2 billion IDs before wrapping — more than enough for a
 * 24/7 ambient server.
 */

let nextId = 2000;

/**
 * Returns a unique node ID for a new synth.
 * @returns {number}
 */
export function allocNodeId() {
  return nextId++;
}

/**
 * Returns a batch of unique node IDs.
 * @param {number} count
 * @returns {number[]}
 */
export function allocNodeIds(count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(nextId++);
  }
  return ids;
}

/**
 * Resets the allocator (for testing only).
 */
export function resetNodeIds() {
  nextId = 2000;
}

// ── Well-known group IDs (must match sc/startup.scd) ──

export const GROUPS = {
  BUS_CLEAR:   99,
  SOURCES:     100,
  PAD:         110,
  LEAD:        111,
  DRONE:       112,
  TEXTURE:     113,
  ARCHIVE:     114,
  FREESOUND:   115,
  PEDAL_PAD:   116,
  BASS_SUPPORT: 117,
  EFFECTS:     200,
  REVERBS:     300,
  MASTER:      400,
};

// ── Well-known bus numbers (must match sc/synthdefs.scd) ──

export const BUSES = {
  MASTER:       2,
  PAD:          4,
  DRONE:        6,
  LEAD:         8,
  TEXTURE:     10,
  ARCHIVE:     12,
  FREESOUND:   14,
  REVERB_SHORT: 16,
  REVERB_LONG:  18,
  PEDAL_PAD:    20,
  BASS_SUPPORT: 22,
};

// ── Control buses for metering (written by \busMeter synths) ──
// Each meter writes 2 values: [rms, peak] to adjacent control buses.
// Total: 6 meters × 2 = 12 control buses (100–111).
export const METER_CTL_BUSES = {
  DRONE:     100,  // 100=rms, 101=peak
  LEAD:      102,
  TEXTURE:   104,
  ARCHIVE:   106,
  FREESOUND: 108,
  MASTER:    110,
};

export const METER_CTL_START = 100;
export const METER_CTL_COUNT = 12;  // 6 meters × 2 values
