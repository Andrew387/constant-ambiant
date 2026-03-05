#!/usr/bin/env python3
"""
Normalize sample volumes across Bass and Lead instrument groups.

Two-pass process:
  Pass 1 — Intra-instrument: compress each note's RMS toward the instrument's
           median, reducing deviation by COMPRESSION_RATIO. Caps boost/cut at
           ±MAX_BOOST_DB to avoid inflating noise on out-of-range notes.
  Pass 2 — Inter-instrument: apply a flat gain per instrument so all instruments
           in the same group (Bass or Lead) share the same average RMS.

A hard peak limiter at PEAK_CEILING_DB prevents clipping after both passes.
Creates backups in samples_backup/ before modifying anything.

Usage:
  python3 -m venv .venv && source .venv/bin/activate
  pip install numpy soundfile
  python3 normalize_volume.py

To restore originals:
  rm -rf samples/Bass samples/Lead
  cp -r samples_backup/* samples/
"""

import os
import shutil
import numpy as np
import soundfile as sf
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
COMPRESSION_RATIO = 0.60   # reduce deviation from median by this fraction
MAX_BOOST_DB      = 12.0   # never boost a note more than this (avoids inflating noise)
MAX_CUT_DB        = 12.0   # never cut a note more than this
PEAK_CEILING_DB   = -0.5   # final peak limiter ceiling
# ──────────────────────────────────────────────────────────────────────────────

BASE = Path(__file__).parent / "samples"
BACKUP = Path(__file__).parent / "samples_backup"

CATEGORIES = {
    "Bass": BASE / "Bass",
    "Lead": BASE / "Lead",
}

def rms_db(data):
    if data.ndim > 1:
        data = data.mean(axis=1)
    rms = np.sqrt(np.mean(data ** 2))
    if rms == 0:
        return -120.0
    return 20.0 * np.log10(rms)

def peak_db(data):
    if data.ndim > 1:
        data = data.mean(axis=1)
    pk = np.max(np.abs(data))
    if pk == 0:
        return -120.0
    return 20.0 * np.log10(pk)

def db_to_lin(db):
    return 10.0 ** (db / 20.0)

def apply_gain_db(data, gain_db):
    return data * db_to_lin(gain_db)

def peak_limit(data, ceiling_db):
    """Hard peak limiter — scales down if peak exceeds ceiling."""
    pk = np.max(np.abs(data))
    ceiling_lin = db_to_lin(ceiling_db)
    if pk > ceiling_lin:
        data = data * (ceiling_lin / pk)
    return data


def collect_instruments():
    """Return list of (category, sub_category, instrument_name, dir_path)."""
    instruments = []
    for cat_name, cat_path in CATEGORIES.items():
        for sub_cat in ["Loopable", "Plucked"]:
            sub_path = cat_path / sub_cat
            if not sub_path.exists():
                continue
            for inst_dir in sorted(sub_path.iterdir()):
                if inst_dir.is_dir():
                    instruments.append((cat_name, sub_cat, inst_dir.name, inst_dir))
    return instruments


def backup_instrument(inst_dir):
    """Copy instrument directory into samples_backup/ preserving structure."""
    rel = inst_dir.relative_to(BASE)
    dest = BACKUP / rel
    if dest.exists():
        return  # already backed up
    dest.mkdir(parents=True, exist_ok=True)
    for wav in inst_dir.glob("*.wav"):
        shutil.copy2(str(wav), str(dest / wav.name))


def analyze_and_normalize_intra(inst_dir):
    """
    Pass 1 — intra-instrument normalization.
    Returns (new_avg_rms_db, n_files).
    """
    wavs = sorted(inst_dir.glob("*.wav"))
    
    # First pass: measure all RMS values
    measurements = []
    for wav in wavs:
        data, sr = sf.read(str(wav), dtype='float64')
        r = rms_db(data)
        measurements.append((wav, data, sr, r))
    
    rms_vals = [m[3] for m in measurements]
    median_rms = np.median(rms_vals)
    
    # Second pass: apply compression toward median
    new_rms_vals = []
    for wav, data, sr, r in measurements:
        if r <= -100:
            # Essentially silent — skip
            new_rms_vals.append(r)
            continue
        
        deviation = r - median_rms
        # We want to reduce the deviation by COMPRESSION_RATIO
        target_rms = median_rms + deviation * (1.0 - COMPRESSION_RATIO)
        gain = target_rms - r
        
        # Clamp the gain
        gain = max(-MAX_CUT_DB, min(MAX_BOOST_DB, gain))
        
        if abs(gain) < 0.1:
            new_rms_vals.append(r)
            continue  # negligible change, skip
        
        data = apply_gain_db(data, gain)
        data = peak_limit(data, PEAK_CEILING_DB)
        
        sf.write(str(wav), data, sr)
        new_rms_vals.append(rms_db(data))
    
    return np.mean(new_rms_vals), len(wavs)


def normalize_inter(inst_dir, gain_db):
    """
    Pass 2 — apply a flat gain to every file in the instrument.
    """
    if abs(gain_db) < 0.2:
        return  # negligible
    
    wavs = sorted(inst_dir.glob("*.wav"))
    for wav in wavs:
        data, sr = sf.read(str(wav), dtype='float64')
        data = apply_gain_db(data, gain_db)
        data = peak_limit(data, PEAK_CEILING_DB)
        sf.write(str(wav), data, sr)


def main():
    instruments = collect_instruments()
    
    # ── Backup ────────────────────────────────────────────────────────────────
    print("Backing up originals…")
    for cat, sub, name, inst_dir in instruments:
        backup_instrument(inst_dir)
    print(f"  ✓ Backups in {BACKUP}/\n")
    
    # ── Pass 1: Intra-instrument normalization ────────────────────────────────
    print("Pass 1: Intra-instrument normalization (compress toward median)…")
    post_intra = {}  # (cat, name) → avg_rms after pass 1
    for cat, sub, name, inst_dir in instruments:
        avg_rms, n = analyze_and_normalize_intra(inst_dir)
        post_intra[(cat, name)] = avg_rms
        print(f"  [{cat}/{sub}] {name}: new avg RMS = {avg_rms:+.1f} dBFS  ({n} files)")
    
    # ── Pass 2: Inter-instrument normalization ────────────────────────────────
    print("\nPass 2: Inter-instrument normalization (match group target)…")
    
    for cat_name in CATEGORIES:
        group_rms = [v for (c, n), v in post_intra.items() if c == cat_name]
        if len(group_rms) < 2:
            continue
        target = np.mean(group_rms)
        print(f"\n  {cat_name} group target: {target:+.1f} dBFS")
        
        for cat, sub, name, inst_dir in instruments:
            if cat != cat_name:
                continue
            current = post_intra[(cat, name)]
            adj = target - current
            print(f"    {name:<25}: {adj:+.1f} dB adjustment")
            normalize_inter(inst_dir, adj)
    
    # ── Verification pass ─────────────────────────────────────────────────────
    print("\n── Verification ──")
    for cat_name in CATEGORIES:
        print(f"\n  {cat_name}:")
        for cat, sub, name, inst_dir in instruments:
            if cat != cat_name:
                continue
            wavs = sorted(inst_dir.glob("*.wav"))
            rms_vals = []
            for wav in wavs:
                data, _ = sf.read(str(wav), dtype='float64')
                rms_vals.append(rms_db(data))
            avg = np.mean(rms_vals)
            rng = np.max(rms_vals) - np.min(rms_vals)
            std = np.std(rms_vals)
            print(f"    {name:<25}  avg={avg:+.1f}  range={rng:.1f}  std={std:.1f}")
    
    print("\n✓ Done! Originals backed up in samples_backup/")


if __name__ == "__main__":
    main()
