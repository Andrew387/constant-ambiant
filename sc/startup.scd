// ============================================================
// Constant Ambient — SuperCollider Server Startup
// ============================================================
//
// Run this in sclang before starting the Node.js controller:
//   sclang sc/startup.scd
//
// This boots scsynth, compiles all SynthDefs, and sets up the
// group/bus structure that Node.js expects.
// ============================================================

(
// ── Server configuration ──
s = Server.default;
s.options.numOutputBusChannels = 2;
s.options.numInputBusChannels = 0;
// Don't force sampleRate — let the output device decide.
// Set s.options.sampleRate if you need a specific rate.
s.options.memSize = 65536;     // 64 MB real-time memory
s.options.numBuffers = 2048;
s.options.maxNodes = 4096;
s.options.numAudioBusChannels = 256;
s.options.blockSize = 128;

// ── Audio devices ──
// Don't set outDevice — scsynth uses the macOS system default output.
// Select your Bluetooth headphones / speakers in System Settings → Sound.
//
// Force input to built-in mic so that Bluetooth headphones stay in A2C
// (high-quality stereo) mode. Without this, scsynth may open the BT
// device for input too, triggering HFP/SCO (8kHz telephony) mode.
s.options.inDevice = "MacBook Air Microphone";

// Boot the server
s.waitForBoot({
    // Load all SynthDef definitions
    thisProcess.interpreter.executeFile(
        PathName(thisProcess.nowExecutingPath).pathOnly +/+ "synthdefs.scd"
    );

    s.sync;  // wait for SynthDefs to be received

    // ── Create group hierarchy ──
    // Execution order: busClear → sources → effects → reverbs → master
    //
    // IMPORTANT: Bus clearing must happen FIRST (Group 99) so that
    // source synths write to clean buses. If clearing happened in
    // the effects group (after sources), it would erase the audio
    // that sources just wrote → silence.
    s.sendMsg(\g_new, 99,  0, 0);   // Bus clear (head of default — runs first)
    s.sendMsg(\g_new, 100, 3, 99);  // Sources (after bus clear)
    s.sendMsg(\g_new, 200, 3, 100); // Effects (after sources)
    s.sendMsg(\g_new, 300, 3, 200); // Reverbs (after effects)
    s.sendMsg(\g_new, 400, 3, 300); // Master (after reverbs)

    // Source sub-groups
    s.sendMsg(\g_new, 110, 0, 100); // Pad voices
    s.sendMsg(\g_new, 111, 0, 100); // Lead voices
    s.sendMsg(\g_new, 112, 0, 100); // Drone/Bass voices
    s.sendMsg(\g_new, 113, 0, 100); // Texture player
    s.sendMsg(\g_new, 114, 0, 100); // Archive player
    s.sendMsg(\g_new, 115, 0, 100); // Freesound players
    s.sendMsg(\g_new, 116, 0, 100); // Pedal pad voices

    s.sync;

    // ── Bus clear synths ──
    // All buses that receive Out.ar (additive) signals must be zeroed
    // each audio cycle to prevent accumulation. Placed in Group 99
    // which runs BEFORE sources, effects, reverbs, and master.
    [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].do({ |bus|
        s.sendMsg(\s_new, \busClear, s.nextNodeID, 0, 99,
            \bus, bus);
    });

    s.sync;

    "\n============================================".postln;
    "[startup] Server booted and ready.".postln;
    "[startup] UDP port: %".format(s.addr.port).postln;
    "[startup] Sample rate: %".format(s.sampleRate).postln;
    "[startup] Groups: 99(busClear) 100(src) 200(fx) 300(rev) 400(master)".postln;
    "[startup] Source groups: 110(pad) 111(lead) 112(drone) 113(tex) 114(arc) 115(fs) 116(pedal)".postln;
    "[startup] Track buses: pad=4 drone=6 lead=8 tex=10 arc=12 fs=14 pedal=20".postln;
    "[startup] Reverb buses: short=16 long=18".postln;
    "[startup] Master bus: 2".postln;
    "============================================\n".postln;
    "[startup] Waiting for Node.js controller on port %...".format(s.addr.port).postln;
});
)
