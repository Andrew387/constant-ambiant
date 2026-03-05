/**
 * SuperCollider boot manager.
 *
 * Spawns sclang as a child process, feeds it sc/startup.scd,
 * and waits for the "Server booted and ready" message.
 *
 * On shutdown, kills sclang (which also stops scsynth).
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const STARTUP_SCRIPT = path.join(PROJECT_ROOT, 'sc', 'startup.scd');

let sclangProcess = null;

/**
 * Finds the sclang binary. Checks:
 *   1. SCLANG_PATH env var
 *   2. On PATH (via `which`)
 *   3. Common macOS install locations
 */
function findSclang() {
  // 1. Env var override
  if (process.env.SCLANG_PATH) {
    if (fs.existsSync(process.env.SCLANG_PATH)) return process.env.SCLANG_PATH;
    throw new Error(`SCLANG_PATH="${process.env.SCLANG_PATH}" not found`);
  }

  // 2. Check PATH
  try {
    const result = execSync('which sclang', { encoding: 'utf-8' }).trim();
    if (result) return result;
  } catch { /* not on PATH */ }

  // 3. Common macOS locations
  const candidates = [
    '/Applications/SuperCollider.app/Contents/MacOS/sclang',
    '/Applications/SuperCollider/SuperCollider.app/Contents/MacOS/sclang',
    path.join(process.env.HOME || '', 'Applications/SuperCollider.app/Contents/MacOS/sclang'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(
    'Could not find sclang. Install SuperCollider or set SCLANG_PATH env var.'
  );
}

/**
 * Boots SuperCollider by spawning sclang with the startup script.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeout=30000] - Max time to wait for boot (ms)
 * @param {boolean} [opts.verbose=true] - Print sclang output
 * @returns {Promise<void>} Resolves when scsynth is booted and ready
 */
export function bootSuperCollider({ timeout = 30000, verbose = true } = {}) {
  return new Promise((resolve, reject) => {
    let sclangPath;
    try {
      sclangPath = findSclang();
    } catch (err) {
      reject(err);
      return;
    }

    if (verbose) {
      console.log(`[sc] Found sclang: ${sclangPath}`);
      console.log(`[sc] Loading: ${STARTUP_SCRIPT}`);
    }

    sclangProcess = spawn(sclangPath, [STARTUP_SCRIPT], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let booted = false;

    const bootTimeout = setTimeout(() => {
      if (!booted) {
        reject(new Error('[sc] Timeout waiting for scsynth to boot'));
        killSuperCollider();
      }
    }, timeout);

    sclangProcess.stdout.on('data', (data) => {
      const text = data.toString();

      if (verbose) {
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) console.log(`  [sclang] ${trimmed}`);
        }
      }

      // Detect the ready message from our startup.scd
      if (!booted && text.includes('Server booted and ready')) {
        booted = true;
        clearTimeout(bootTimeout);
        // Give SC a moment to finish group/bus setup after the ready message
        setTimeout(() => resolve(), 500);
      }
    });

    sclangProcess.stderr.on('data', (data) => {
      const text = data.toString();
      if (verbose) {
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) console.log(`  [sclang:err] ${trimmed}`);
        }
      }
    });

    sclangProcess.on('error', (err) => {
      clearTimeout(bootTimeout);
      reject(new Error(`[sc] Failed to start sclang: ${err.message}`));
    });

    sclangProcess.on('close', (code) => {
      if (!booted) {
        clearTimeout(bootTimeout);
        reject(new Error(`[sc] sclang exited with code ${code} before booting`));
      } else {
        console.log(`[sc] sclang exited (code ${code})`);
      }
      sclangProcess = null;
    });
  });
}

/**
 * Kills the sclang child process (which also stops scsynth).
 */
export function killSuperCollider() {
  if (!sclangProcess) return;
  console.log('[sc] Shutting down sclang + scsynth...');
  try {
    // Send s.quit to sclang to cleanly shut down scsynth
    sclangProcess.stdin.write('s.quit;\n');
    // Give it a moment, then force kill
    const proc = sclangProcess;
    setTimeout(() => {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    }, 2000);
  } catch {
    if (sclangProcess) sclangProcess.kill('SIGKILL');
  }
  sclangProcess = null;
}

/**
 * Returns true if sclang is currently running.
 */
export function isSclangRunning() {
  return sclangProcess !== null && !sclangProcess.killed;
}
