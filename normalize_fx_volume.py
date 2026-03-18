#!/usr/bin/env python3
"""
Normalize FX sample volumes (Riser and Boomer collections).

Same two-pass approach as normalize_volume.py:
  Pass 1 — Intra-collection: compress each file's RMS toward the collection's
           median, reducing deviation by COMPRESSION_RATIO.
  Pass 2 — Inter-collection: apply flat gain so all collections in the same
           FX type (Riser or Boomer) share the same average RMS.

Peak limiter at PEAK_CEILING_DB prevents clipping after both passes.
Creates backups in samples_backup/FX/ before modifying anything.

Usage:
  source .venv/bin/activate  # needs numpy + soundfile
  python3 normalize_fx_volume.py
"""

import os
import shutil
import numpy as np
import soundfile as sf
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
COMPRESSION_RATIO = 0.60
MAX_BOOST_DB      = 12.0
MAX_CUT_DB        = 12.0
PEAK_CEILING_DB   = -0.5
# ──────────────────────────────────────────────────────────────────────────────

BASE = Path(__file__).parent / "samples" / "FX"
BACKUP = Path(__file__).parent / "samples_backup" / "FX"

FX_TYPES = ["Riser", "Boomer"]


def rms_db(data):
    if data.ndim > 1:
        data = data.mean(axis=1)
    rms = np.sqrt(np.mean(data ** 2))
    if rms == 0:
        return -120.0
    return 20.0 * np.log10(rms)


def db_to_lin(db):
    return 10.0 ** (db / 20.0)


def apply_gain_db(data, gain_db):
    return data * db_to_lin(gain_db)


def peak_limit(data, ceiling_db):
    pk = np.max(np.abs(data))
    ceiling_lin = db_to_lin(ceiling_db)
    if pk > ceiling_lin:
        data = data * (ceiling_lin / pk)
    return data


def collect_collections():
    """Return list of (fx_type, collection_name, dir_path)."""
    collections = []
    for fx_type in FX_TYPES:
        type_path = BASE / fx_type
        if not type_path.exists():
            continue
        for coll_dir in sorted(type_path.iterdir()):
            if coll_dir.is_dir():
                collections.append((fx_type, coll_dir.name, coll_dir))
    return collections


def backup_collection(coll_dir):
    rel = coll_dir.relative_to(BASE)
    dest = BACKUP / rel
    if dest.exists():
        return
    dest.mkdir(parents=True, exist_ok=True)
    for wav in coll_dir.glob("*.wav"):
        shutil.copy2(str(wav), str(dest / wav.name))


def normalize_intra(coll_dir):
    """Pass 1 — compress each file's RMS toward the collection's median."""
    wavs = sorted(coll_dir.glob("*.wav"))

    measurements = []
    for wav in wavs:
        data, sr = sf.read(str(wav), dtype='float64')
        r = rms_db(data)
        measurements.append((wav, data, sr, r))

    rms_vals = [m[3] for m in measurements]
    median_rms = np.median(rms_vals)

    new_rms_vals = []
    for wav, data, sr, r in measurements:
        if r <= -100:
            new_rms_vals.append(r)
            continue

        deviation = r - median_rms
        target_rms = median_rms + deviation * (1.0 - COMPRESSION_RATIO)
        gain = target_rms - r
        gain = max(-MAX_CUT_DB, min(MAX_BOOST_DB, gain))

        if abs(gain) < 0.1:
            new_rms_vals.append(r)
            continue

        data = apply_gain_db(data, gain)
        data = peak_limit(data, PEAK_CEILING_DB)
        sf.write(str(wav), data, sr)
        new_rms_vals.append(rms_db(data))

    return np.mean(new_rms_vals), len(wavs)


def normalize_inter(coll_dir, gain_db):
    """Pass 2 — apply a flat gain to every file in the collection."""
    if abs(gain_db) < 0.2:
        return
    wavs = sorted(coll_dir.glob("*.wav"))
    for wav in wavs:
        data, sr = sf.read(str(wav), dtype='float64')
        data = apply_gain_db(data, gain_db)
        data = peak_limit(data, PEAK_CEILING_DB)
        sf.write(str(wav), data, sr)


def main():
    collections = collect_collections()
    if not collections:
        print("No FX collections found.")
        return

    # ── Backup ────────────────────────────────────────────────────────────────
    print("Backing up originals…")
    for fx_type, name, coll_dir in collections:
        backup_collection(coll_dir)
    print(f"  ✓ Backups in {BACKUP}/\n")

    # ── Pass 1: Intra-collection normalization ────────────────────────────────
    print("Pass 1: Intra-collection normalization (compress toward median)…")
    post_intra = {}
    for fx_type, name, coll_dir in collections:
        avg_rms, n = normalize_intra(coll_dir)
        post_intra[(fx_type, name)] = avg_rms
        print(f"  [{fx_type}] {name}: new avg RMS = {avg_rms:+.1f} dBFS  ({n} files)")

    # ── Pass 2: Inter-collection normalization ────────────────────────────────
    print("\nPass 2: Inter-collection normalization (match type target)…")

    for fx_type in FX_TYPES:
        group_rms = [v for (t, n), v in post_intra.items() if t == fx_type]
        if len(group_rms) < 2:
            continue
        target = np.mean(group_rms)
        print(f"\n  {fx_type} group target: {target:+.1f} dBFS")

        for ft, name, coll_dir in collections:
            if ft != fx_type:
                continue
            current = post_intra[(ft, name)]
            adj = target - current
            print(f"    {name:<30}: {adj:+.1f} dB adjustment")
            normalize_inter(coll_dir, adj)

    # ── Verification ──────────────────────────────────────────────────────────
    print("\n── Verification ──")
    for fx_type in FX_TYPES:
        print(f"\n  {fx_type}:")
        for ft, name, coll_dir in collections:
            if ft != fx_type:
                continue
            wavs = sorted(coll_dir.glob("*.wav"))
            rms_vals = []
            for wav in wavs:
                data, _ = sf.read(str(wav), dtype='float64')
                rms_vals.append(rms_db(data))
            avg = np.mean(rms_vals)
            rng = np.max(rms_vals) - np.min(rms_vals)
            std = np.std(rms_vals)
            print(f"    {name:<30}  avg={avg:+.1f}  range={rng:.1f}  std={std:.1f}")

    print("\n✓ Done! Originals backed up in samples_backup/FX/")


if __name__ == "__main__":
    main()
