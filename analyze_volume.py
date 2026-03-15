#!/usr/bin/env python3
"""
Analyze the loudness (RMS in dB, peak in dB) of all Bass and Lead samples.
Reports per-instrument stats and cross-instrument comparison.

Usage:
  python3 -m venv .venv && source .venv/bin/activate
  pip install numpy soundfile
  python3 analyze_volume.py
"""

import os
import numpy as np
import soundfile as sf
from pathlib import Path
import json

BASE = Path(__file__).parent / "samples"

CATEGORIES = {
    "Bass": BASE / "Bass",
    "Lead": BASE / "Lead",
    "Bass-Lead": BASE / "Bass-Lead",
}

def rms_db(data):
    """RMS level in dBFS."""
    # If stereo, convert to mono
    if data.ndim > 1:
        data = data.mean(axis=1)
    rms = np.sqrt(np.mean(data ** 2))
    if rms == 0:
        return -120.0
    return 20 * np.log10(rms)

def peak_db(data):
    """Peak level in dBFS."""
    if data.ndim > 1:
        data = data.mean(axis=1)
    peak = np.max(np.abs(data))
    if peak == 0:
        return -120.0
    return 20 * np.log10(peak)

def analyze_instrument(instrument_dir):
    """Analyze all WAV files in an instrument directory."""
    wavs = sorted(instrument_dir.glob("*.wav"))
    results = []
    for wav_path in wavs:
        try:
            data, sr = sf.read(str(wav_path), dtype='float64')
            r = rms_db(data)
            p = peak_db(data)
            results.append({
                "file": wav_path.name,
                "rms_db": round(r, 2),
                "peak_db": round(p, 2),
            })
        except Exception as e:
            results.append({"file": wav_path.name, "error": str(e)})
    return results

def print_report(category_name, instruments_data):
    print(f"\n{'='*80}")
    print(f"  {category_name} SAMPLES ANALYSIS")
    print(f"{'='*80}")
    
    summary = []
    
    for inst_name, sub_cat, results in instruments_data:
        rms_vals = [r["rms_db"] for r in results if "rms_db" in r]
        peak_vals = [r["peak_db"] for r in results if "peak_db" in r]
        
        if not rms_vals:
            continue
        
        avg_rms = np.mean(rms_vals)
        min_rms = np.min(rms_vals)
        max_rms = np.max(rms_vals)
        std_rms = np.std(rms_vals)
        avg_peak = np.mean(peak_vals)
        
        # Find quietest and loudest notes
        sorted_by_rms = sorted(results, key=lambda x: x.get("rms_db", -120))
        
        print(f"\n  [{sub_cat}] {inst_name}")
        print(f"  {'─'*60}")
        print(f"  Avg RMS:  {avg_rms:+.1f} dBFS")
        print(f"  Min RMS:  {min_rms:+.1f} dBFS  ({sorted_by_rms[0]['file']})")
        print(f"  Max RMS:  {max_rms:+.1f} dBFS  ({sorted_by_rms[-1]['file']})")
        print(f"  Range:    {max_rms - min_rms:.1f} dB")
        print(f"  Std Dev:  {std_rms:.1f} dB")
        print(f"  Avg Peak: {avg_peak:+.1f} dBFS")
        
        # Flag notes that are far from the mean
        outliers = [r for r in results if abs(r.get("rms_db", avg_rms) - avg_rms) > 2 * std_rms and std_rms > 0.5]
        if outliers:
            print(f"  ⚠ Outliers (>2σ from mean):")
            for o in sorted(outliers, key=lambda x: x["rms_db"]):
                diff = o["rms_db"] - avg_rms
                print(f"    {o['file']}: {o['rms_db']:+.1f} dBFS ({diff:+.1f} from mean)")
        
        summary.append({
            "name": inst_name,
            "sub_category": sub_cat,
            "avg_rms": round(avg_rms, 2),
            "min_rms": round(min_rms, 2),
            "max_rms": round(max_rms, 2),
            "range_db": round(max_rms - min_rms, 2),
            "std_db": round(std_rms, 2),
            "avg_peak": round(avg_peak, 2),
            "n_files": len(rms_vals),
        })
    
    # Cross-instrument comparison
    print(f"\n  {'─'*60}")
    print(f"  CROSS-INSTRUMENT COMPARISON ({category_name})")
    print(f"  {'─'*60}")
    print(f"  {'Instrument':<25} {'SubCat':<10} {'Avg RMS':>10} {'Range':>8} {'StdDev':>8}")
    for s in summary:
        print(f"  {s['name']:<25} {s['sub_category']:<10} {s['avg_rms']:>+10.1f} {s['range_db']:>7.1f} {s['std_db']:>7.1f}")
    
    if len(summary) > 1:
        all_rms = [s["avg_rms"] for s in summary]
        target = np.mean(all_rms)
        print(f"\n  Target avg RMS for group: {target:+.1f} dBFS")
        print(f"  Adjustments needed:")
        for s in summary:
            adj = target - s["avg_rms"]
            print(f"    {s['name']:<25}: {adj:+.1f} dB")
    
    return summary

def main():
    all_summaries = {}
    
    for cat_name, cat_path in CATEGORIES.items():
        instruments_data = []
        
        for sub_cat in ["Loopable", "Plucked"]:
            sub_path = cat_path / sub_cat
            if not sub_path.exists():
                continue
            
            for inst_dir in sorted(sub_path.iterdir()):
                if inst_dir.is_dir():
                    results = analyze_instrument(inst_dir)
                    instruments_data.append((inst_dir.name, sub_cat, results))
        
        if instruments_data:
            summary = print_report(cat_name, instruments_data)
            all_summaries[cat_name] = summary
    
    # Save raw data for the normalization step
    with open("volume_analysis.json", "w") as f:
        json.dump(all_summaries, f, indent=2)
    
    print(f"\n\nDetailed data saved to volume_analysis.json")

if __name__ == "__main__":
    main()
