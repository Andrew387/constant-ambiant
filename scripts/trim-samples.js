#!/usr/bin/env node

/**
 * Trim and rename sample files.
 *
 * Deletes unused samples outside each instrument's playable note range,
 * then renames remaining files from sequential numbering (prefix01.wav)
 * to note-name format (prefix_C2.wav, prefix_Cs2.wav, etc.).
 *
 * Categories and their kept ranges:
 *   Lead      → C2–B4  (files 13–48)
 *   Bass      → C2–B2  (files 13–24)
 *   Pad       → C1–B3  (files 01–36)
 *   Bass-Lead → C2–B4  (files 13–48)
 *
 * Usage:
 *   node scripts/trim-samples.js          # dry run (preview only)
 *   node scripts/trim-samples.js --apply  # actually delete & rename
 */

import fs from 'fs';
import path from 'path';

const DRY_RUN = !process.argv.includes('--apply');

const SAMPLES_DIR = path.resolve(process.cwd(), 'samples');

// Note names using 's' for sharp (filesystem-safe)
const FILE_NOTE_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

// File index (1-based) to note name mapping
function indexToNote(fileIndex) {
  const zeroIdx = fileIndex - 1;
  const octave = Math.floor(zeroIdx / 12) + 1;
  const noteIdx = zeroIdx % 12;
  return `${FILE_NOTE_NAMES[noteIdx]}${octave}`;
}

// Category → range of file indices to KEEP (inclusive)
const CATEGORY_RANGES = {
  lead:     { start: 13, end: 48 },  // C2–B4
  bass:     { start: 13, end: 24 },  // C2–B2
  pad:      { start: 1,  end: 36 },  // C1–B3
  bassLead: { start: 13, end: 48 },  // C2–B4
};

// Determine category from directory path
function categorize(instrumentDir) {
  const rel = path.relative(SAMPLES_DIR, instrumentDir);
  if (rel.startsWith('Bass-Lead'))  return 'bassLead';
  if (rel.startsWith('Bass'))       return 'bass';
  if (rel.startsWith('Lead'))       return 'lead';
  if (rel.startsWith('pad'))        return 'pad';
  return null;
}

// Find all instrument directories (leaf dirs containing .wav files)
function findInstrumentDirs(baseDir) {
  const dirs = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const hasWav = entries.some(e => e.isFile() && e.name.endsWith('.wav'));
    if (hasWav) {
      dirs.push(dir);
      return; // leaf instrument dir
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
    }
  }
  walk(baseDir);
  return dirs;
}

// Extract the 2-digit index and prefix from a filename like "malechoirlong01.wav"
function parseFilename(filename) {
  const match = filename.match(/^(.+?)(\d{2})\.wav$/i);
  if (!match) return null;
  return { prefix: match[1], index: parseInt(match[2], 10) };
}

// Process one instrument directory
function processInstrument(instrumentDir) {
  const category = categorize(instrumentDir);
  if (!category) {
    console.log(`  SKIP (unknown category): ${path.relative(SAMPLES_DIR, instrumentDir)}`);
    return { deleted: 0, renamed: 0 };
  }

  const range = CATEGORY_RANGES[category];
  const relPath = path.relative(SAMPLES_DIR, instrumentDir);
  const files = fs.readdirSync(instrumentDir).filter(f => f.endsWith('.wav')).sort();

  let deleted = 0;
  let renamed = 0;
  let prefix = null;

  // First pass: identify prefix and delete out-of-range files
  for (const file of files) {
    const parsed = parseFilename(file);
    if (!parsed) {
      console.log(`  WARN: unparseable filename: ${file}`);
      continue;
    }

    if (!prefix) prefix = parsed.prefix;

    if (parsed.index < range.start || parsed.index > range.end) {
      const fullPath = path.join(instrumentDir, file);
      if (DRY_RUN) {
        console.log(`  DELETE: ${file}`);
      } else {
        fs.unlinkSync(fullPath);
      }
      deleted++;
    }
  }

  // Second pass: rename kept files with note names
  // In dry-run mode, files weren't actually deleted, so filter by range
  const keptFiles = (DRY_RUN
    ? files.filter(f => { const p = parseFilename(f); return p && p.index >= range.start && p.index <= range.end; })
    : fs.readdirSync(instrumentDir).filter(f => f.endsWith('.wav'))
  ).sort();
  for (const file of keptFiles) {
    const parsed = parseFilename(file);
    if (!parsed) continue;

    const noteName = indexToNote(parsed.index);
    const newFilename = `${parsed.prefix}_${noteName}.wav`;

    if (file !== newFilename) {
      const oldPath = path.join(instrumentDir, file);
      const newPath = path.join(instrumentDir, newFilename);
      if (DRY_RUN) {
        console.log(`  RENAME: ${file} → ${newFilename}`);
      } else {
        fs.renameSync(oldPath, newPath);
      }
      renamed++;
    }
  }

  const kept = (range.end - range.start + 1);
  console.log(`  ${relPath} [${category}]: keep ${kept} (${indexToNote(range.start)}–${indexToNote(range.end)}), delete ${deleted}, rename ${renamed}`);

  return { deleted, renamed };
}

// Main
console.log(DRY_RUN ? '=== DRY RUN (pass --apply to execute) ===' : '=== APPLYING CHANGES ===');
console.log();

const instrumentDirs = findInstrumentDirs(SAMPLES_DIR);
// Exclude texturesNew — those aren't note-based instruments
const filtered = instrumentDirs.filter(d => !path.relative(SAMPLES_DIR, d).startsWith('texturesNew'));

let totalDeleted = 0;
let totalRenamed = 0;

for (const dir of filtered) {
  const { deleted, renamed } = processInstrument(dir);
  totalDeleted += deleted;
  totalRenamed += renamed;
}

console.log();
console.log(`Total: ${totalDeleted} files to delete, ${totalRenamed} files to rename`);
console.log(`Across ${filtered.length} instrument directories`);

if (DRY_RUN) {
  console.log('\nRun with --apply to execute these changes.');
}
