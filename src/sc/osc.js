/**
 * OSC communication with SuperCollider's scsynth server.
 *
 * Uses a SINGLE UDP socket (dgram) for both sending and receiving,
 * bound to a fixed local port. This ensures scsynth replies (/done,
 * /fail, /b_info, /synced) route back to the same socket that sent
 * the request — which is how scsynth's reply addressing works.
 *
 * Message encoding/decoding via osc-min.
 */

import dgram from 'dgram';
import osc from 'osc-min';

// ── Connection defaults ──────────────────────────────────
const SC_HOST = process.env.SC_HOST || '127.0.0.1';
const SC_PORT = parseInt(process.env.SC_PORT || '57110', 10);
const LOCAL_PORT = parseInt(process.env.OSC_LOCAL_PORT || '57130', 10);

let sock = null;

// Pending reply callbacks: Map<id, { type, resolve, reject, timer, ...match }>
const pending = new Map();
let idCounter = 0;
let syncIdCounter = 1;

// ─────────────────────────────────────────────────────────
//  Lifecycle
// ─────────────────────────────────────────────────────────

/**
 * Opens the UDP socket, binds to LOCAL_PORT, and sends /notify 1
 * so scsynth routes async notifications (n_go, n_end, etc.) to us.
 *
 * @returns {Promise<void>} Resolves when socket is bound
 */
export function initOSC() {
  return new Promise((resolve, reject) => {
    if (sock) { resolve(); return; }

    sock = dgram.createSocket('udp4');

    sock.on('error', (err) => {
      console.error(`[osc] Socket error: ${err.message}`);
      // Reject only if we haven't resolved yet (bind failure)
      reject(err);
    });

    sock.on('message', (buf) => {
      try {
        routeIncoming(osc.fromBuffer(buf));
      } catch {
        // Ignore malformed OSC packets
      }
    });

    sock.bind(LOCAL_PORT, '0.0.0.0', () => {
      console.log(`[osc] Bound to UDP port ${LOCAL_PORT}`);
      console.log(`[osc] Targeting scsynth at ${SC_HOST}:${SC_PORT}`);

      // Note: we do NOT send /notify 1 here because sclang already
      // occupies the only notification slot (maxLogins=1). Our request/reply
      // patterns (/done, /synced, /b_info) work regardless of /notify.

      resolve();
    });
  });
}

/**
 * Closes the socket and rejects all pending callbacks.
 */
export function closeOSC() {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error('[osc] Connection closed'));
  }
  pending.clear();

  if (sock) {
    try { sock.close(); } catch { /* already closed */ }
    sock = null;
  }
  console.log('[osc] Closed');
}

// ─────────────────────────────────────────────────────────
//  Incoming message router
// ─────────────────────────────────────────────────────────

function routeIncoming(msg) {
  // Recurse into bundles
  if (msg.oscType === 'bundle') {
    for (const el of msg.elements) routeIncoming(el);
    return;
  }

  const address = msg.address;
  const args = msg.args.map(a => a.value);

  switch (address) {
    case '/done': {
      const cmd = args[0];    // e.g. '/b_allocRead'
      const bufNum = args[1]; // buffer number (if applicable)

      for (const [id, p] of pending) {
        if (p.type === 'done' &&
            p.cmd === cmd &&
            (p.bufNum === undefined || p.bufNum === bufNum)) {
          clearTimeout(p.timer);
          pending.delete(id);
          p.resolve(args);
          return;
        }
      }
      break;
    }

    case '/synced': {
      const syncId = args[0];
      for (const [id, p] of pending) {
        if (p.type === 'sync' && p.syncId === syncId) {
          clearTimeout(p.timer);
          pending.delete(id);
          p.resolve();
          return;
        }
      }
      break;
    }

    case '/b_info': {
      // /b_info bufNum numFrames numChannels sampleRate
      for (const [id, p] of pending) {
        if (p.type === 'b_info' && p.bufNum === args[0]) {
          clearTimeout(p.timer);
          pending.delete(id);
          p.resolve({
            bufNum: args[0],
            numFrames: args[1],
            numChannels: args[2],
            sampleRate: args[3],
          });
          return;
        }
      }
      break;
    }

    case '/c_setn': {
      // /c_setn busIndex count val0 val1 ...
      for (const [id, p] of pending) {
        if (p.type === 'c_setn') {
          clearTimeout(p.timer);
          pending.delete(id);
          p.resolve(args);
          return;
        }
      }
      break;
    }

    case '/c_set': {
      // /c_set busIndex value ... (reply to /c_get)
      for (const [id, p] of pending) {
        if (p.type === 'c_set') {
          clearTimeout(p.timer);
          pending.delete(id);
          p.resolve(args);
          return;
        }
      }
      break;
    }

    case '/status.reply': {
      // /status.reply: unused, numUGens, numSynths, numGroups, numSynthDefs,
      //                avgCPU, peakCPU, nominalSampleRate, actualSampleRate
      for (const [id, p] of pending) {
        if (p.type === 'status_reply') {
          clearTimeout(p.timer);
          pending.delete(id);
          p.resolve({
            numUGens:       args[1],
            numSynths:      args[2],
            numGroups:      args[3],
            numSynthDefs:   args[4],
            avgCPU:         args[5],
            peakCPU:        args[6],
            nominalSR:      args[7],
            actualSR:       args[8],
          });
          return;
        }
      }
      break;
    }

    case '/fail':
      console.warn(`[osc] scsynth /fail: ${args.join(' ')}`);
      break;

    // Silently ignore /n_go, /n_end, etc.
  }
}

// ─────────────────────────────────────────────────────────
//  Sending
// ─────────────────────────────────────────────────────────

/**
 * Converts a JS value to an osc-min typed argument.
 */
function toOscArg(val) {
  if (typeof val === 'string') return { type: 'string', value: val };
  if (typeof val === 'number') {
    return Number.isInteger(val)
      ? { type: 'integer', value: val }
      : { type: 'float', value: val };
  }
  return { type: 'string', value: String(val) };
}

/**
 * Sends a single OSC message to scsynth.
 * @param {string} address - e.g. '/s_new', '/n_set'
 * @param {...any} args
 */
export function send(address, ...args) {
  if (!sock) {
    console.warn('[osc] Socket not initialised — call initOSC() first');
    return;
  }
  const buf = osc.toBuffer({ address, args: args.map(toOscArg) });
  sock.send(buf, 0, buf.length, SC_PORT, SC_HOST);
}

/**
 * Sends an OSC bundle (multiple messages executed atomically).
 * @param {Array<[string, ...any]>} messages - Array of [address, ...args]
 * @param {Date|number[]|number} [timetag=[0,1]] - NTP timetag; [0,1] = immediately
 */
export function sendBundle(messages, timetag = [0, 1]) {
  if (!sock || messages.length === 0) return;

  const elements = messages.map(([address, ...args]) => ({
    address,
    args: args.map(toOscArg),
  }));
  const buf = osc.toBuffer({ oscType: 'bundle', timetag, elements });
  sock.send(buf, 0, buf.length, SC_PORT, SC_HOST);
}

// ─────────────────────────────────────────────────────────
//  Request → Reply helpers
// ─────────────────────────────────────────────────────────

/**
 * Sends a message and returns a Promise that resolves when
 * the corresponding /done reply arrives from scsynth.
 *
 * @param {string} address - OSC address (e.g. '/b_allocRead')
 * @param {Array} args - Message arguments
 * @param {object} [opts]
 * @param {number} [opts.timeout=10000]
 * @param {number} [opts.bufNum] - Buffer number to match in reply
 * @returns {Promise<Array>} Reply arguments
 */
export function sendAndWait(address, args, opts = {}) {
  const { timeout = 10000, bufNum } = opts;

  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`[osc] Timeout waiting for /done ${address} (${timeout}ms)`));
    }, timeout);

    pending.set(id, { type: 'done', cmd: address, bufNum, resolve, reject, timer });
    send(address, ...args);
  });
}

/**
 * Sends /sync and waits for /synced — guarantees all previous
 * asynchronous commands have completed on the server.
 *
 * Also useful as a server "ping" to verify scsynth is alive.
 *
 * @param {number} [timeout=10000]
 * @returns {Promise<void>}
 */
export function sync(timeout = 10000) {
  const syncId = syncIdCounter++;

  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`[osc] Timeout waiting for /synced ${syncId} (${timeout}ms)`));
    }, timeout);

    pending.set(id, { type: 'sync', syncId, resolve, reject, timer });
    send('/sync', syncId);
  });
}

// ─────────────────────────────────────────────────────────
//  Convenience wrappers for common scsynth commands
// ─────────────────────────────────────────────────────────

/**
 * /s_new — create a synth.
 * @param {string} defName
 * @param {number} nodeId
 * @param {number} addAction - 0=head, 1=tail, 3=after
 * @param {number} targetId - Group or node to position relative to
 * @param {Object<string, number>} [params={}] - Control name/value pairs
 */
export function synthNew(defName, nodeId, addAction, targetId, params = {}) {
  const args = [defName, nodeId, addAction, targetId];
  for (const [key, value] of Object.entries(params)) {
    args.push(key, value);
  }
  send('/s_new', ...args);
}

/**
 * /n_set — set controls on an existing node.
 * @param {number} nodeId
 * @param {Object<string, number>} params - Control name/value pairs
 */
export function nodeSet(nodeId, params) {
  const args = [nodeId];
  for (const [key, value] of Object.entries(params)) {
    args.push(key, value);
  }
  send('/n_set', ...args);
}

/**
 * /n_free — free a node.
 * @param {number} nodeId
 */
export function nodeFree(nodeId) {
  send('/n_free', nodeId);
}

/**
 * /g_new — create a group.
 * @param {number} groupId
 * @param {number} addAction
 * @param {number} targetId
 */
export function groupNew(groupId, addAction, targetId) {
  send('/g_new', groupId, addAction, targetId);
}

/**
 * /b_allocRead — allocate a buffer and read a sound file into it.
 * Returns a Promise that resolves when scsynth sends /done.
 *
 * @param {number} bufNum
 * @param {string} filePath - Absolute path to audio file
 * @param {number} [startFrame=0]
 * @param {number} [numFrames=0] - 0 = read entire file
 * @returns {Promise<Array>}
 */
export function bufferAllocRead(bufNum, filePath, startFrame = 0, numFrames = 0) {
  return sendAndWait('/b_allocRead', [bufNum, filePath, startFrame, numFrames], {
    bufNum,
    timeout: 30000,
  });
}

/**
 * /b_allocReadChannel — allocate a buffer and read specific channels from a sound file.
 * Use this to force mono loading (channels=[0]) for SynthDefs that expect mono buffers.
 *
 * @param {number} bufNum
 * @param {string} filePath - Absolute path to audio file
 * @param {number[]} channels - Array of channel indices to read (e.g. [0] for mono)
 * @param {number} [startFrame=0]
 * @param {number} [numFrames=0] - 0 = read entire file
 * @returns {Promise<Array>}
 */
export function bufferAllocReadChannel(bufNum, filePath, channels, startFrame = 0, numFrames = 0) {
  return sendAndWait('/b_allocReadChannel',
    [bufNum, filePath, startFrame, numFrames, ...channels],
    { bufNum, timeout: 30000 }
  );
}

/**
 * /b_free — free a buffer.
 * @param {number} bufNum
 */
export function bufferFree(bufNum) {
  send('/b_free', bufNum);
}

/**
 * /b_query — query buffer info. Returns a Promise with buffer metadata.
 * @param {number} bufNum
 * @returns {Promise<{ bufNum: number, numFrames: number, numChannels: number, sampleRate: number }>}
 */
export function bufferQuery(bufNum) {
  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`[osc] Timeout waiting for /b_info for buffer ${bufNum}`));
    }, 5000);

    pending.set(id, { type: 'b_info', bufNum, resolve, reject, timer });
    send('/b_query', bufNum);
  });
}

/**
 * /c_getn — read a contiguous range of control bus values.
 * Returns a Promise that resolves with the raw args array:
 *   [busIndex, count, val0, val1, ...]
 *
 * @param {number} busIndex - First control bus to read
 * @param {number} count - Number of buses to read
 * @param {number} [timeout=1000]
 * @returns {Promise<number[]>}
 */
export function controlBusGetN(busIndex, count, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`[osc] Timeout waiting for /c_setn`));
    }, timeout);

    pending.set(id, { type: 'c_setn', resolve, reject, timer });
    send('/c_getn', busIndex, count);
  });
}

/**
 * Queries scsynth status — returns UGen/synth counts, CPU, sample rate.
 * Useful for diagnosing audio issues (e.g. after sleep/wake).
 *
 * @param {number} [timeout=3000]
 * @returns {Promise<{ numUGens, numSynths, numGroups, numSynthDefs, avgCPU, peakCPU, nominalSR, actualSR }>}
 */
export function queryStatus(timeout = 3000) {
  return new Promise((resolve, reject) => {
    const id = ++idCounter;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`[osc] Timeout waiting for /status.reply (${timeout}ms)`));
    }, timeout);

    pending.set(id, { type: 'status_reply', resolve, reject, timer });
    send('/status');
  });
}

// ─────────────────────────────────────────────────────────
//  Health check
// ─────────────────────────────────────────────────────────

let healthCheckTimer = null;
let consecutiveFailures = 0;
let lastCheckTimestamp = 0;

/**
 * Starts a periodic health check that pings scsynth via /sync
 * AND queries /status to report UGen counts, CPU, and sample rate.
 *
 * Also detects system sleep/wake by checking if the wall-clock gap
 * between ticks is much larger than the interval (timers freeze
 * during macOS sleep). On wake detection, calls onSleepWake.
 *
 * @param {object} [opts]
 * @param {number} [opts.interval=15000] - Check interval in ms
 * @param {function} [opts.onDead] - Called after 3 consecutive failures
 * @param {function} [opts.onSleepWake] - Called when sleep/wake is detected
 */
export function startHealthCheck(opts = {}) {
  const interval = opts.interval ?? 15000;
  const onDead = opts.onDead ?? null;
  const onSleepWake = opts.onSleepWake ?? null;

  stopHealthCheck();
  consecutiveFailures = 0;
  lastCheckTimestamp = Date.now();

  healthCheckTimer = setInterval(async () => {
    const now = Date.now();
    const elapsed = now - lastCheckTimestamp;
    lastCheckTimestamp = now;

    // If elapsed >> interval, timers were frozen (system slept)
    const sleepDetected = elapsed > interval * 3;
    if (sleepDetected) {
      const sleepDuration = Math.round((elapsed - interval) / 1000);
      console.warn(`[osc] System sleep/wake detected (gap: ${sleepDuration}s)`);
    }

    // Ping scsynth
    try {
      await sync(5000);
      if (consecutiveFailures > 0) {
        console.log(`[osc] scsynth recovered after ${consecutiveFailures} failed pings`);
      }
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures++;
      console.warn(`[osc] scsynth health check failed (${consecutiveFailures})`);
      if (consecutiveFailures >= 3 && onDead) {
        onDead();
      }
      return; // skip status query if ping failed
    }

    // Query detailed status
    try {
      const st = await queryStatus(3000);
      const cpuStr = `avg:${st.avgCPU.toFixed(1)}% peak:${st.peakCPU.toFixed(1)}%`;
      const srStr = `SR:${st.actualSR}/${st.nominalSR}`;
      console.log(`[sc-status] UGens:${st.numUGens} synths:${st.numSynths} groups:${st.numGroups} | CPU ${cpuStr} | ${srStr}`);

      // Check for bad audio state
      if (st.numSynths === 0 && !sleepDetected) {
        console.warn('[sc-status] No active synths — audio may have stopped');
      }
      if (st.actualSR === 0) {
        console.warn('[sc-status] Actual sample rate is 0 — audio device likely disconnected');
      }
    } catch {
      console.warn('[sc-status] Failed to query scsynth status');
    }

    // Trigger sleep/wake recovery
    if (sleepDetected && onSleepWake) {
      onSleepWake(elapsed);
    }
  }, interval);
}

/**
 * Stops the periodic health check.
 */
export function stopHealthCheck() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

/**
 * Resets the consecutive failure counter.
 * Call after a successful recovery so the health check doesn't
 * immediately re-trigger onDead from stale failure counts.
 */
export function resetHealthCheckFailures() {
  consecutiveFailures = 0;
}
