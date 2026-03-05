# Audio Output Status Check

## Current Configuration

✅ **scsynth output device**: `MacBook Air Speakers`  
✅ **Sample rate**: 48kHz stereo (2 channels)  
✅ **masterOut synth**: Routes master bus → hardware bus 0  
✅ **Node.js server**: Running and generating music  

## To Verify Audio is Playing

1. **Check macOS volume**:
   - Press F12 (volume up) or check menu bar volume icon
   - Ensure volume is not muted

2. **Check System Settings**:
   - System Settings → Sound → Output
   - Ensure "MacBook Air Speakers" is selected (not "andrecoutedelamusique" or another device)

3. **Listen for audio**:
   - The engine generates ambient music continuously
   - You should hear: pad chords, lead samples, bass/drone, texture loops, Archive.org audio, Freesound SFX

## If Still No Audio

Check the Node.js terminal logs for errors. The server logs show:
- `[mixer] Initialized — all tracks, effects, reverbs, and master ready`
- `[engine] starting — C minor, 56bpm`
- `[section] ...` messages showing automation cycling

If you see these logs, the audio pipeline is active and should be playing through your speakers.

## Alternative: Route to BlackHole (for streaming/recording)

If you want to route audio to a DAW or streaming app:

1. Install BlackHole: `brew install --cask blackhole-16ch`
2. Edit `sc/startup.scd` line 28: `s.options.outDevice = "BlackHole 16ch";`
3. Restart SuperCollider: `Ctrl+C` then `npm run sc:boot`
4. Set your DAW/streaming app input to "BlackHole 16ch"
