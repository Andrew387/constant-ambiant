// Simple audio test — plays a 440Hz sine wave for 5 seconds
// If you can hear this, scsynth audio output is working.
(
s.options.outDevice = "MacBook Air Speakers";
s.options.numOutputBusChannels = 2;
s.options.numInputBusChannels = 0;

s.waitForBoot({
    "=== TESTING AUDIO OUTPUT ===".postln;
    ("Output device: " ++ s.options.outDevice).postln;
    ("Sample rate: " ++ s.sampleRate).postln;
    ("Num output channels: " ++ s.options.numOutputBusChannels).postln;

    // Play a simple sine wave at 440Hz directly to hardware output
    x = { SinOsc.ar(440, 0, 0.3) ! 2 }.play;

    ">>> You should hear a 440Hz tone now <<<".postln;
    ">>> Stopping in 5 seconds... <<<".postln;

    // Stop after 5 seconds
    SystemClock.sched(5, {
        x.free;
        "=== Test tone stopped ===".postln;
        "=== If you heard nothing, check System Settings → Sound → Output ===".postln;
        0.exit;
    });
});
)
