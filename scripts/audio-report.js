#!/usr/bin/env node
/**
 * Professional Audio Report Generator
 *
 * Reads a JSONL recording from audio-recorder.js and produces:
 *   1. levels.csv           — per-track RMS/peak/dB over time
 *   2. spectrum-31.csv      — per-track 31-band 1/3-octave energy over time
 *   3. stereo.csv           — per-track L/R/mid/side/correlation/width over time
 *   4. loudness.csv         — per-track K-weighted LUFS + true peak over time
 *   5. automation.csv       — per-track brightness/filter/duck over time
 *   6. master-fx.csv        — master effect parameters over time
 *   7. sections.csv         — section timeline with durations
 *   8. masking-matrix.csv   — track-vs-track frequency overlap matrix
 *   9. summary.txt          — comprehensive mixing/mastering analysis
 *
 * Usage:
 *   node scripts/audio-report.js <recording.jsonl> [--outdir <dir>]
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ── Parse args ──
const args = process.argv.slice(2);
const inputPath = args.find(a => !a.startsWith('--'));
if (!inputPath) {
  console.error('Usage: node scripts/audio-report.js <recording.jsonl> [--outdir <dir>]');
  process.exit(1);
}
const outdirIdx = args.indexOf('--outdir');
const outdir = outdirIdx !== -1 && args[outdirIdx + 1]
  ? args[outdirIdx + 1]
  : inputPath.replace(/\.jsonl$/, '-report');

if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });

// ── Constants ──
const BAND_NAMES = [
  '20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160',
  '200', '250', '315', '400', '500', '630', '800', '1k', '1.25k', '1.6k',
  '2k', '2.5k', '3.15k', '4k', '5k', '6.3k', '8k', '10k', '12.5k', '16k', '20k',
];
const BAND_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];
// Coarse groupings for the masking matrix summary
const BAND_GROUPS = {
  'sub (20-63 Hz)':       [0, 1, 2, 3],       // 20–50 Hz bands
  'bass (63-250 Hz)':     [4, 5, 6, 7, 8],    // 63–160 Hz
  'low-mid (250-630 Hz)': [9, 10, 11, 12, 13], // 200–500 Hz
  'mid (630-2k Hz)':      [14, 15, 16, 17],   // 630–1.6k Hz
  'upper-mid (2k-6.3k)':  [18, 19, 20, 21],   // 2k–4k Hz
  'presence (6.3k-12.5k)':[22, 23, 24, 25],   // 5k–10k Hz
  'air (12.5k-20k Hz)':   [26, 27, 28, 29, 30],// 12.5k–20k Hz
};

function ampToDb(amp) { return amp > 1e-5 ? 20 * Math.log10(amp) : -100; }
function ampToLUFS(amp) { return amp > 1e-5 ? -0.691 + 20 * Math.log10(amp) : -100; }

// ── Row accumulators ──
const levelRows = [];
const spectrumRows = [];
const stereoRows = [];
const loudnessRows = [];
const automationRows = [];
const masterFXRows = [];
const sectionEvents = [];

// ── Stats accumulators ──
const trackLevelStats = {};  // track → { rmsSum, count, peakMax, dbValues[] }
const trackSpectrumStats = {}; // track → { bandSums[31], bandSqSums[31], count }
const trackStereoStats = {};   // track → { corrValues[], widthValues[], lrBalanceValues[], count }
const trackLoudnessStats = {}; // track → { momentaryValues[], shortTermValues[], truePeakMax }

let lastSection = null;
let totalSamples = 0;
let firstTs = null;
let lastTs = null;

function ensureLevelStats(t) {
  if (!trackLevelStats[t]) trackLevelStats[t] = { rmsSum: 0, count: 0, peakMax: 0, dbValues: [] };
}
function ensureSpectrumStats(t) {
  if (!trackSpectrumStats[t]) trackSpectrumStats[t] = {
    bandSums: new Float64Array(31), bandSqSums: new Float64Array(31), count: 0,
  };
}
function ensureStereoStats(t) {
  if (!trackStereoStats[t]) trackStereoStats[t] = {
    corrValues: [], widthValues: [], lrBalanceValues: [], count: 0,
  };
}
function ensureLoudnessStats(t) {
  if (!trackLoudnessStats[t]) trackLoudnessStats[t] = {
    momentaryValues: [], shortTermValues: [], truePeakMax: 0,
  };
}

// ── Read JSONL ──
console.log(`[report] Reading ${inputPath}...`);
const rl = readline.createInterface({
  input: fs.createReadStream(inputPath), crlfDelay: Infinity,
});

for await (const line of rl) {
  if (!line.trim()) continue;
  let r;
  try { r = JSON.parse(line); } catch { continue; }
  totalSamples++;
  const elapsed = r.elapsed;
  if (!firstTs) firstTs = r.ts;
  lastTs = r.ts;

  // ── Levels ──
  if (r.levels) {
    for (const [track, { rms, peak, db }] of Object.entries(r.levels)) {
      levelRows.push({ elapsed, track, rms, peak, db });
      ensureLevelStats(track);
      const s = trackLevelStats[track];
      s.rmsSum += rms; s.count++;
      if (peak > s.peakMax) s.peakMax = peak;
      if (db > -100) s.dbValues.push(db);
    }
  }

  // ── Analysis (spectrum + stereo + loudness) ──
  if (r.analysis) {
    for (const [track, data] of Object.entries(r.analysis)) {
      // Spectrum
      if (data.spectrum) {
        const row = { elapsed, track };
        for (const b of BAND_NAMES) row[b] = data.spectrum[b] || 0;
        spectrumRows.push(row);

        ensureSpectrumStats(track);
        const ss = trackSpectrumStats[track];
        ss.count++;
        for (let i = 0; i < 31; i++) {
          const v = data.spectrum[BAND_NAMES[i]] || 0;
          ss.bandSums[i] += v;
          ss.bandSqSums[i] += v * v;
        }
      }

      // Stereo
      if (data.stereo) {
        const st = data.stereo;
        stereoRows.push({
          elapsed, track,
          lRms: st.lRms, rRms: st.rRms, midRms: st.midRms, sideRms: st.sideRms,
          correlation: st.correlation, width: st.width,
        });
        ensureStereoStats(track);
        const ss = trackStereoStats[track];
        ss.corrValues.push(st.correlation);
        ss.widthValues.push(st.width);
        if (st.lRms > 0 || st.rRms > 0) {
          ss.lrBalanceValues.push(st.lRms / (st.lRms + st.rRms + 1e-10));
        }
        ss.count++;
      }

      // Loudness
      if (data.loudness) {
        const ld = data.loudness;
        loudnessRows.push({
          elapsed, track,
          momentaryLUFS: ampToLUFS(ld.momentary),
          shortTermLUFS: ampToLUFS(ld.shortTerm),
          truePeakDb: ampToDb(ld.truePeak),
        });
        ensureLoudnessStats(track);
        const ls = trackLoudnessStats[track];
        ls.momentaryValues.push(ld.momentary);
        ls.shortTermValues.push(ld.shortTerm);
        if (ld.truePeak > ls.truePeakMax) ls.truePeakMax = ld.truePeak;
      }
    }
  }

  // ── Automation ──
  if (r.automation && r.automation.tracks) {
    for (const [track, d] of Object.entries(r.automation.tracks)) {
      automationRows.push({ elapsed, track, bright: d.bright, freq: d.freq, duck: d.duck, status: d.status });
    }
    const section = r.automation.currentSection;
    if (section && section !== lastSection) {
      sectionEvents.push({ elapsed, section });
      lastSection = section;
    }
  }

  // ── Master FX ──
  if (r.masterFX) masterFXRows.push({ elapsed, ...r.masterFX });
}

const totalDuration = totalSamples > 0 ? (new Date(lastTs) - new Date(firstTs)) / 1000 : 0;
console.log(`[report] ${totalSamples} samples over ${(totalDuration / 60).toFixed(1)} minutes`);

// ── Helpers ──
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(Math.floor(s.length * p / 100), s.length - 1)];
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// ── Write CSVs ──
function writeCsv(filename, headers, rows) {
  const filePath = path.join(outdir, filename);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map(h => {
      const v = row[h];
      if (v === undefined || v === null) return '';
      if (typeof v === 'number') return Number.isInteger(v) ? v : v.toFixed(5);
      if (typeof v === 'string' && v.includes(',')) return `"${v}"`;
      return v;
    }).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
  console.log(`[report]   ${filename} (${rows.length} rows)`);
}

writeCsv('levels.csv', ['elapsed', 'track', 'rms', 'peak', 'db'], levelRows);
writeCsv('spectrum-31.csv', ['elapsed', 'track', ...BAND_NAMES], spectrumRows);
writeCsv('stereo.csv', ['elapsed', 'track', 'lRms', 'rRms', 'midRms', 'sideRms', 'correlation', 'width'], stereoRows);
writeCsv('loudness.csv', ['elapsed', 'track', 'momentaryLUFS', 'shortTermLUFS', 'truePeakDb'], loudnessRows);
if (automationRows.length > 0)
  writeCsv('automation.csv', ['elapsed', 'track', 'bright', 'freq', 'duck', 'status'], automationRows);
if (masterFXRows.length > 0) {
  const fxH = ['elapsed', ...Object.keys(masterFXRows[0]).filter(k => k !== 'elapsed')];
  writeCsv('master-fx.csv', fxH, masterFXRows);
}
if (sectionEvents.length > 0) {
  const withDur = sectionEvents.map((ev, i) => {
    const next = i < sectionEvents.length - 1 ? sectionEvents[i + 1].elapsed : totalDuration;
    return { ...ev, duration: next - ev.elapsed };
  });
  writeCsv('sections.csv', ['elapsed', 'section', 'duration'], withDur);
}

// ── Masking matrix ──
// For each pair of tracks, compute overlap in each frequency region
const analysedTracks = Object.keys(trackSpectrumStats).filter(t => t !== 'master');
if (analysedTracks.length > 1) {
  const maskingRows = [];
  for (let i = 0; i < analysedTracks.length; i++) {
    for (let j = i + 1; j < analysedTracks.length; j++) {
      const t1 = analysedTracks[i], t2 = analysedTracks[j];
      const s1 = trackSpectrumStats[t1], s2 = trackSpectrumStats[t2];
      const row = { trackA: t1, trackB: t2 };
      for (const [groupName, indices] of Object.entries(BAND_GROUPS)) {
        // Geometric mean of avg amplitudes in this group for each track
        let sum1 = 0, sum2 = 0;
        for (const idx of indices) {
          sum1 += s1.bandSums[idx] / s1.count;
          sum2 += s2.bandSums[idx] / s2.count;
        }
        const avg1 = sum1 / indices.length;
        const avg2 = sum2 / indices.length;
        // Masking potential = min of both (both must be present for masking)
        const maskDb = ampToDb(Math.min(avg1, avg2));
        row[groupName] = maskDb > -100 ? maskDb : -100;
      }
      maskingRows.push(row);
    }
  }
  const maskHeaders = ['trackA', 'trackB', ...Object.keys(BAND_GROUPS)];
  writeCsv('masking-matrix.csv', maskHeaders, maskingRows);
}

// ══════════════════════════════════════════════════════════════════
//  SUMMARY REPORT
// ══════════════════════════════════════════════════════════════════

const W = 80;
const out = [];

out.push('═'.repeat(W));
out.push('  CONSTANT AMBIENT — PROFESSIONAL AUDIO ANALYSIS REPORT');
out.push('═'.repeat(W));
out.push('');
out.push(`Recording:  ${inputPath}`);
out.push(`Started:    ${firstTs}`);
out.push(`Ended:      ${lastTs}`);
out.push(`Duration:   ${(totalDuration / 60).toFixed(1)} minutes (${totalDuration.toFixed(0)}s)`);
out.push(`Samples:    ${totalSamples} (every ~${totalSamples > 1 ? (totalDuration / (totalSamples - 1) * 1000).toFixed(0) : '?'}ms)`);
out.push('');

// ── 1. Per-track level summary ──
out.push('─'.repeat(W));
out.push('  1. PER-TRACK LEVELS (dBFS)');
out.push('─'.repeat(W));
out.push('');
out.push(
  'Track'.padEnd(16) +
  'Avg'.padStart(7) + 'Med'.padStart(7) + 'Min'.padStart(7) + 'Max'.padStart(7) +
  'Peak'.padStart(7) + 'Range'.padStart(7) + 'Crest'.padStart(7)
);
out.push('─'.repeat(65));

const sortedTracks = Object.entries(trackLevelStats)
  .filter(([, s]) => s.dbValues.length > 0)
  .sort(([, a], [, b]) => mean(b.dbValues) - mean(a.dbValues));

for (const [track, s] of sortedTracks) {
  const avg = mean(s.dbValues);
  const med = median(s.dbValues);
  const peakDb = ampToDb(s.peakMax);
  const range = s.dbValues.length > 1 ? (percentile(s.dbValues, 95) - percentile(s.dbValues, 5)) : 0;
  const crest = peakDb - avg;
  out.push(
    track.padEnd(16) +
    avg.toFixed(1).padStart(7) + med.toFixed(1).padStart(7) +
    Math.min(...s.dbValues).toFixed(1).padStart(7) + Math.max(...s.dbValues).toFixed(1).padStart(7) +
    peakDb.toFixed(1).padStart(7) + range.toFixed(1).padStart(7) + crest.toFixed(1).padStart(7)
  );
}

// ── 2. 1/3-octave frequency balance ──
out.push('');
out.push('─'.repeat(W));
out.push('  2. FREQUENCY BALANCE — 1/3-OCTAVE (avg dBFS per track)');
out.push('─'.repeat(W));
out.push('');

// Print in a condensed table: 7 coarse groups
const groupNames = Object.keys(BAND_GROUPS);
out.push('Track'.padEnd(16) + groupNames.map(g => g.split(' ')[0].padStart(10)).join(''));
out.push('─'.repeat(16 + groupNames.length * 10));

for (const track of [...analysedTracks, 'master']) {
  const ss = trackSpectrumStats[track];
  if (!ss || ss.count === 0) continue;
  let line = track.padEnd(16);
  for (const [, indices] of Object.entries(BAND_GROUPS)) {
    let sum = 0;
    for (const idx of indices) sum += ss.bandSums[idx] / ss.count;
    const avgAmp = sum / indices.length;
    const db = ampToDb(avgAmp);
    line += (db > -100 ? db.toFixed(1) : '---').padStart(10);
  }
  out.push(line);
}

// Master detailed 31-band spectrum with visual bars
if (trackSpectrumStats.master && trackSpectrumStats.master.count > 0) {
  out.push('');
  out.push('Master 1/3-octave detail:');
  const ms = trackSpectrumStats.master;
  for (let i = 0; i < 31; i++) {
    const avgAmp = ms.bandSums[i] / ms.count;
    const db = ampToDb(avgAmp);
    const barLen = db > -100 ? Math.max(0, Math.round((db + 80) * 0.6)) : 0;
    const bar = '█'.repeat(barLen);
    out.push(`  ${BAND_NAMES[i].padEnd(7)} ${(BAND_FREQS[i] + ' Hz').padEnd(10)} ${(db > -100 ? db.toFixed(1) : '---').padStart(7)} dB  ${bar}`);
  }
}

// ── 3. Stereo field analysis ──
out.push('');
out.push('─'.repeat(W));
out.push('  3. STEREO FIELD ANALYSIS');
out.push('─'.repeat(W));
out.push('');
out.push(
  'Track'.padEnd(16) +
  'Avg Corr'.padStart(10) + 'Med Corr'.padStart(10) +
  'Avg Width'.padStart(10) + 'Med Width'.padStart(10) +
  'L/R Bal'.padStart(10) + 'Verdict'.padStart(14)
);
out.push('─'.repeat(80));

for (const track of [...analysedTracks, 'master']) {
  const ss = trackStereoStats[track];
  if (!ss || ss.count === 0) continue;
  const avgCorr = mean(ss.corrValues);
  const medCorr = median(ss.corrValues);
  const avgWidth = mean(ss.widthValues);
  const medWidth = median(ss.widthValues);
  const avgBal = mean(ss.lrBalanceValues);  // 0.5 = centered
  const balStr = ss.lrBalanceValues.length > 0
    ? (avgBal > 0.55 ? 'L-heavy' : avgBal < 0.45 ? 'R-heavy' : 'centered')
    : '---';

  let verdict = '';
  if (avgCorr > 0.9) verdict = 'mono';
  else if (avgCorr > 0.7) verdict = 'narrow';
  else if (avgCorr > 0.3) verdict = 'moderate';
  else if (avgCorr > 0) verdict = 'wide';
  else verdict = 'very wide';

  out.push(
    track.padEnd(16) +
    avgCorr.toFixed(3).padStart(10) + medCorr.toFixed(3).padStart(10) +
    avgWidth.toFixed(3).padStart(10) + medWidth.toFixed(3).padStart(10) +
    balStr.padStart(10) + verdict.padStart(14)
  );
}

// ── 4. Loudness analysis (LUFS) ──
out.push('');
out.push('─'.repeat(W));
out.push('  4. LOUDNESS ANALYSIS (LUFS / dBFS)');
out.push('─'.repeat(W));
out.push('');

out.push(
  'Track'.padEnd(16) +
  'Integ LUFS'.padStart(11) + 'Avg Short'.padStart(11) +
  'LRA'.padStart(7) + 'True Peak'.padStart(11) + 'Headroom'.padStart(10)
);
out.push('─'.repeat(66));

for (const track of [...analysedTracks, 'master']) {
  const ls = trackLoudnessStats[track];
  if (!ls || ls.momentaryValues.length === 0) continue;

  // Integrated LUFS = -0.691 + 10*log10(mean of squared K-weighted RMS)
  const meanSq = mean(ls.momentaryValues.map(v => v * v));
  const integrated = meanSq > 1e-10 ? -0.691 + 10 * Math.log10(meanSq) : -100;

  // Short-term LUFS average
  const stMeanSq = mean(ls.shortTermValues.map(v => v * v));
  const avgST = stMeanSq > 1e-10 ? -0.691 + 10 * Math.log10(stMeanSq) : -100;

  // Loudness Range (LRA) — difference between P95 and P10 of short-term LUFS
  const stLufs = ls.shortTermValues.filter(v => v > 1e-5).map(v => -0.691 + 20 * Math.log10(v));
  const lra = stLufs.length > 10 ? percentile(stLufs, 95) - percentile(stLufs, 10) : 0;

  const truePeakDb = ampToDb(ls.truePeakMax);
  const headroom = -truePeakDb;  // dB below 0 dBFS

  out.push(
    track.padEnd(16) +
    (integrated > -100 ? integrated.toFixed(1) : '---').padStart(11) +
    (avgST > -100 ? avgST.toFixed(1) : '---').padStart(11) +
    (lra > 0 ? lra.toFixed(1) : '---').padStart(7) +
    (truePeakDb > -100 ? truePeakDb.toFixed(1) : '---').padStart(11) +
    (headroom > 0 && headroom < 100 ? headroom.toFixed(1) : '---').padStart(10)
  );
}

// ── 5. Dynamic range per frequency region ──
out.push('');
out.push('─'.repeat(W));
out.push('  5. SPECTRAL DYNAMICS — PER-BAND STANDARD DEVIATION (master)');
out.push('─'.repeat(W));
out.push('');

if (trackSpectrumStats.master && trackSpectrumStats.master.count > 1) {
  out.push('Shows how much each frequency band fluctuates over time.');
  out.push('High std = dynamic, Low std = static/droning.');
  out.push('');
  const ms = trackSpectrumStats.master;
  for (let i = 0; i < 31; i++) {
    const avgAmp = ms.bandSums[i] / ms.count;
    const avgSq = ms.bandSqSums[i] / ms.count;
    const variance = avgSq - avgAmp * avgAmp;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const cv = avgAmp > 1e-6 ? (stdDev / avgAmp * 100) : 0; // coefficient of variation %
    const avgDb = ampToDb(avgAmp);
    const barLen = Math.min(40, Math.round(cv * 0.5));
    const bar = '▓'.repeat(barLen);
    out.push(
      `  ${BAND_NAMES[i].padEnd(7)} ${avgDb > -100 ? avgDb.toFixed(1).padStart(7) : '    ---'} dB avg  ` +
      `CV: ${cv.toFixed(0).padStart(3)}%  ${bar}`
    );
  }
}

// ── 6. Spectral centroid per track ──
out.push('');
out.push('─'.repeat(W));
out.push('  6. SPECTRAL CENTROID (brightness indicator)');
out.push('─'.repeat(W));
out.push('');
out.push('Weighted average frequency. Higher = brighter. Reference: ~500-2000 Hz for ambient.');
out.push('');

for (const track of [...analysedTracks, 'master']) {
  const ss = trackSpectrumStats[track];
  if (!ss || ss.count === 0) continue;
  let weightedSum = 0, totalEnergy = 0;
  for (let i = 0; i < 31; i++) {
    const avg = ss.bandSums[i] / ss.count;
    weightedSum += BAND_FREQS[i] * avg;
    totalEnergy += avg;
  }
  const centroid = totalEnergy > 1e-10 ? weightedSum / totalEnergy : 0;
  const label = centroid < 500 ? '(dark)' : centroid < 1500 ? '(warm)' : centroid < 3000 ? '(neutral)' : '(bright)';
  out.push(`  ${track.padEnd(16)} ${centroid.toFixed(0).padStart(6)} Hz  ${label}`);
}

// ── 7. Frequency masking analysis ──
out.push('');
out.push('─'.repeat(W));
out.push('  7. FREQUENCY MASKING — TRACK OVERLAP');
out.push('─'.repeat(W));
out.push('');
out.push('Where two tracks share significant energy, the quieter one may be masked.');
out.push('Only showing overlaps above -50 dB (audible masking potential).');
out.push('');

const maskingIssues = [];
for (let i = 0; i < analysedTracks.length; i++) {
  for (let j = i + 1; j < analysedTracks.length; j++) {
    const t1 = analysedTracks[i], t2 = analysedTracks[j];
    const s1 = trackSpectrumStats[t1], s2 = trackSpectrumStats[t2];
    for (const [groupName, indices] of Object.entries(BAND_GROUPS)) {
      let sum1 = 0, sum2 = 0;
      for (const idx of indices) {
        sum1 += s1.bandSums[idx] / s1.count;
        sum2 += s2.bandSums[idx] / s2.count;
      }
      const avg1 = sum1 / indices.length;
      const avg2 = sum2 / indices.length;
      const overlapDb = ampToDb(Math.min(avg1, avg2));
      if (overlapDb > -50) {
        maskingIssues.push({
          region: groupName,
          t1, t2,
          db1: ampToDb(avg1), db2: ampToDb(avg2), overlapDb,
        });
      }
    }
  }
}

if (maskingIssues.length === 0) {
  out.push('  No significant frequency masking detected between tracks.');
} else {
  maskingIssues.sort((a, b) => b.overlapDb - a.overlapDb);
  for (const m of maskingIssues.slice(0, 25)) {
    out.push(
      `  ${m.region.padEnd(22)} ${m.t1} (${m.db1.toFixed(0)}dB) × ${m.t2} (${m.db2.toFixed(0)}dB)  ` +
      `overlap: ${m.overlapDb.toFixed(1)} dB`
    );
  }
  if (maskingIssues.length > 25) out.push(`  ... and ${maskingIssues.length - 25} more`);
}

// ── 8. Section timeline ──
if (sectionEvents.length > 0) {
  out.push('');
  out.push('─'.repeat(W));
  out.push('  8. SECTION TIMELINE');
  out.push('─'.repeat(W));
  out.push('');

  const sectionTotals = {};
  for (let i = 0; i < sectionEvents.length; i++) {
    const ev = sectionEvents[i];
    const next = i < sectionEvents.length - 1 ? sectionEvents[i + 1].elapsed : totalDuration;
    const dur = next - ev.elapsed;
    sectionTotals[ev.section] = (sectionTotals[ev.section] || 0) + dur;
    const mm = Math.floor(ev.elapsed / 60);
    const ss = Math.floor(ev.elapsed % 60);
    out.push(`  ${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}  ${ev.section.padEnd(20)} (${dur.toFixed(0)}s)`);
  }
  out.push('');
  out.push('Section totals:');
  for (const [section, total] of Object.entries(sectionTotals).sort((a, b) => b[1] - a[1])) {
    const pct = (total / totalDuration * 100).toFixed(1);
    out.push(`  ${section.padEnd(20)} ${total.toFixed(0).padStart(5)}s  (${pct}%)`);
  }
}

// ── 9. Mixing & Mastering Insights ──
out.push('');
out.push('─'.repeat(W));
out.push('  9. MIXING & MASTERING INSIGHTS');
out.push('─'.repeat(W));
out.push('');

const insights = [];

// Headroom check
if (trackLoudnessStats.master) {
  const tp = ampToDb(trackLoudnessStats.master.truePeakMax);
  if (tp > -1) insights.push(`⚠ HEADROOM: Master true peak at ${tp.toFixed(1)} dBFS — less than 1 dB headroom. Apply limiter.`);
  else if (tp > -3) insights.push(`⚠ HEADROOM: Master true peak at ${tp.toFixed(1)} dBFS — tight headroom. Consider -1 dBTP ceiling.`);
  else if (tp < -12) insights.push(`ℹ HEADROOM: Master true peak at ${tp.toFixed(1)} dBFS — very conservative. Could increase gain.`);
  else insights.push(`✓ HEADROOM: Master true peak at ${tp.toFixed(1)} dBFS — healthy.`);
}

// LUFS target check (ambient music typically -20 to -14 LUFS)
if (trackLoudnessStats.master && trackLoudnessStats.master.momentaryValues.length > 0) {
  const meanSq = mean(trackLoudnessStats.master.momentaryValues.map(v => v * v));
  const intLufs = meanSq > 1e-10 ? -0.691 + 10 * Math.log10(meanSq) : -100;
  if (intLufs > -14) insights.push(`⚠ LOUDNESS: Integrated ${intLufs.toFixed(1)} LUFS — loud for ambient. Target -20 to -14 LUFS.`);
  else if (intLufs < -24) insights.push(`ℹ LOUDNESS: Integrated ${intLufs.toFixed(1)} LUFS — very quiet. Fine for meditation/sleep, may disappear on speakers.`);
  else insights.push(`✓ LOUDNESS: Integrated ${intLufs.toFixed(1)} LUFS — good range for ambient music.`);
}

// Stereo correlation check
if (trackStereoStats.master && trackStereoStats.master.corrValues.length > 0) {
  const avgCorr = mean(trackStereoStats.master.corrValues);
  if (avgCorr > 0.95) insights.push(`ℹ STEREO: Master correlation ${avgCorr.toFixed(2)} — nearly mono. Ambient benefits from more width.`);
  else if (avgCorr < 0.2) insights.push(`⚠ STEREO: Master correlation ${avgCorr.toFixed(2)} — very wide. May collapse on mono playback.`);
  else insights.push(`✓ STEREO: Master correlation ${avgCorr.toFixed(2)} — healthy stereo image.`);
}

// Low-end buildup
if (trackSpectrumStats.master && trackSpectrumStats.master.count > 0) {
  const ms = trackSpectrumStats.master;
  // Average energy in sub (bands 0-3) vs mid (bands 14-17)
  const subE = mean([0, 1, 2, 3].map(i => ms.bandSums[i] / ms.count));
  const midE = mean([14, 15, 16, 17].map(i => ms.bandSums[i] / ms.count));
  const subDb = ampToDb(subE);
  const midDb = ampToDb(midE);
  if (subDb > midDb + 8) insights.push(`⚠ LOW-END: Sub-bass ${(subDb - midDb).toFixed(0)} dB above mids — potential mud. HPF non-bass tracks.`);

  // Presence check
  const presE = mean([22, 23, 24, 25].map(i => ms.bandSums[i] / ms.count));
  const presDb = ampToDb(presE);
  if (presDb < midDb - 15) insights.push(`ℹ PRESENCE: 5k-10k region is ${(midDb - presDb).toFixed(0)} dB below mids — mix may lack definition/air.`);
}

// Track balance relative to master
if (trackLevelStats.master) {
  const masterAvg = mean(trackLevelStats.master.dbValues);
  for (const [track, s] of sortedTracks) {
    if (track === 'master' || s.dbValues.length === 0) continue;
    const avg = mean(s.dbValues);
    if (avg > masterAvg - 2) insights.push(`⚠ BALANCE: ${track} at ${avg.toFixed(1)} dB is within 2 dB of master — dominating the mix.`);
    if (avg < -65) insights.push(`ℹ BALANCE: ${track} averages ${avg.toFixed(1)} dB — barely audible.`);
  }
}

// Masking warnings
const severeMasking = maskingIssues.filter(m => m.overlapDb > -30);
if (severeMasking.length > 0) {
  const regions = [...new Set(severeMasking.map(m => m.region.split(' ')[0]))];
  insights.push(`⚠ MASKING: Significant overlap in ${regions.join(', ')}. Consider EQ carving between competing tracks.`);
}

// Dynamic range (LRA)
if (trackLoudnessStats.master) {
  const stLufs = trackLoudnessStats.master.shortTermValues.filter(v => v > 1e-5).map(v => -0.691 + 20 * Math.log10(v));
  const lra = stLufs.length > 10 ? percentile(stLufs, 95) - percentile(stLufs, 10) : 0;
  if (lra > 0) {
    if (lra < 4) insights.push(`ℹ DYNAMICS: LRA ${lra.toFixed(1)} dB — very compressed. May feel static. Consider more section contrast.`);
    else if (lra > 20) insights.push(`ℹ DYNAMICS: LRA ${lra.toFixed(1)} dB — very wide dynamic range. Quiet passages may be inaudible.`);
    else insights.push(`✓ DYNAMICS: LRA ${lra.toFixed(1)} dB — good dynamic range for ambient.`);
  }
}

if (insights.length === 0) {
  insights.push('✓ No issues detected. Mix appears well-balanced.');
}
for (const i of insights) out.push(`  ${i}`);

// ── Footer ──
out.push('');
out.push('═'.repeat(W));
out.push(`  Generated: ${new Date().toISOString()}`);
out.push(`  Output:    ${outdir}`);
out.push('═'.repeat(W));
out.push('');

const summaryText = out.join('\n');
fs.writeFileSync(path.join(outdir, 'summary.txt'), summaryText);
console.log(`[report]   summary.txt`);
console.log('');
console.log(summaryText);
console.log(`[report] All files written to: ${outdir}`);
