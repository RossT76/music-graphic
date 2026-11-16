// Shared registry for visualisations.
//
// To add one: create visuals/<name>.js that calls MRD.register({ name, draw }),
// then add a <script> tag for it in display.html (before app.js). Tag order is the
// order in the control bar. It can be selected with ?visual=<name>.
//
// draw(api) runs once per animation frame. api provides:
//   ctx, W, H        2D canvas context and the stage size in CSS pixels
//   state            { bass, mid, treble, level (all 0-1), beat (1 on a beat,
//                      decaying), onset (true for one frame per beat), hue,
//                      bpm, phase (0-1 through the current beat), tick (true for
//                      one frame at each beat of the steady beat clock),
//                      beatCount (beats so far),
//                      subBass (50-100 Hz), high (6.4-12.8 kHz), snap (sharpness of
//                      the latest attack), clarity (how steady the beat is), intensity (recent
//                      loudness relative to this source's own peak), punch (bass relative to
//                      its peak), relLevel (loudness right now, relative to its peak),
//                      all 0-1; locked (true while the beat clock is following real
//                      beats - false in silence, when it just free-runs), onsetCount }
//   freq, wave       Uint8Arrays of spectrum / waveform, null until audio starts
//   spec(i, n)       0-1 level of band i of n log-spaced frequency bands
//   fade(alpha)      fade the previous frame towards the background (trails)
//   clearStage()     wipe to the background
//   bgRgb            "r,g,b" of the solid background, or null when transparent
//
// Speed and direction: register with `motion: true` to opt in to the Speed slider and Reverse
// button (visuals without it ignore them, and the controls dim). An opted-in visual should move on
// these instead of performance.now() or a fixed step per frame, which also makes it independent of
// the frame rate (an OBS Browser Source runs at 30 fps by default):
//   dt               real seconds since the last frame (capped at 0.05)
//   speed, dir       the speed multiplier (0.25-3) and direction (1, or -1 when reversed)
//   time             seconds on the flow clock: accumulates dt * speed * direction (use for sin/cos phases)
//   flow             dt * 60 * speed * direction: multiply a per-frame step by it (1 at 60 Hz and 1x)
// (`dir` is the direction asked for. When Auto reverse flips it, time and flow ease through zero over half a
// second rather than jumping, so a visual that switches mode on `dir` should still be fine mid-swing.)
// Don't integrate audio levels into time; add them to the angle or position instead.
// A visual can add its own lines to the controls page's debug panel with `debug: () => rows`, where
// rows is a list of [label, text] or [label, text, fraction 0-1] (the fraction draws a small bar). It is
// only called while debug is switched on, about 8 times a second, so it may build strings freely.
// Also give `reverseLabel`, a short plain description of what Reverse does here ("Rain rises instead
// of falls"); the controls page shows it under the Reverse button.
window.MRD = {
  visuals: [],
  register(visual) { this.visuals.push(visual); },
};
