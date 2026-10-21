// Shared registry for visualisations.
//
// To add one: create visuals/<name>.js that calls MRD.register({ name, draw }),
// then add a <script> tag for it in index.html (before app.js). Tag order is the
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
window.MRD = {
  visuals: [],
  register(visual) { this.visuals.push(visual); },
};
