# Music Reactive Display & Procedural Dancer

A real-time, browser-based live music visualizer and procedural dance animation engine powered by the Web Audio API and HTML5 Canvas.

Designed for live performances, streaming setups (OBS Studio), and audio-reactive experimentation with zero external runtime dependencies.

---

## Features

### 🕺 Procedural Audio-Reactive Dancer (`visuals/dancer.js`)
* **Layered Somatic Decoupling:** Decouples lower body (footwork, bounce, balance) from upper body (expressive gestures, head tilts, arm flourishes), allowing combinations of routines to crossfade without full-body keyframe explosion.
* **Predictive Kinematic Beat Alignment:** Dances to an internal phase-locked loop (PLL) beat clock with analytical phase lead compensation ($2\zeta / \omega$). Joint velocity stops land directly on acoustic beats rather than lagging behind them.
* **Physical Grounding & 3D Two-Bone IK:** Knee joints solve analytically using 3D two-bone Inverse Kinematics, maintaining planted feet with zero foot-sliding and dynamic Center-of-Mass (CoM) balance.
* **Audio-Feature Modulations:**
  * **Sub-Bass (50–100 Hz):** Drives knee flexion depth, vertical dip, and sagittal bounce.
  * **High Frequencies (6.4–12.8 kHz):** Excites rapid distal adjustments (wrist flicks, head gestures).
  * **Percussive Snap:** Sharp envelope attacks stiffen joint spring dampers for crisp, popping stops.
  * **Pulse Clarity:** When rhythmic regularity drops (e.g. rubato, breakdown), cadenced stepping relaxes and arms enter exploratory "searching" behavior.

### 🎨 Comprehensive Visualization Suite
Includes 20 audio-reactive visuals in `visuals/`:
* **Dancer:** Procedural neon skeleton dancing in time with the music.
* **Skull:** A 3D holographic human skull (modelled to real proportions, with eye sockets, cheekbones, a hinged jaw and a full set of teeth) on a projector base. It sweeps left and right and snaps its jaw open on every beat (harder hits open it wider), with scanlines, flicker, glitch slices and a light cone.
* **X-ray Skull:** The same skull as a solid, sculpted surface in steel blue with an X-ray rim glow, solid enamel teeth and fine sutures, drawn with WebGL. Same sweep and beat-driven jaw. The first time it is shown it spends a second or two building the skull (with a progress ring).
* **Bars, Radial, Particles, Scope, XY Scope:** Classic and oscilloscope-style frequency and waveform visualizers.
* **Tunnel, Kaleidoscope, Hypno:** Geometric, rhythmic hypnotic tunnels and symmetry patterns.
* **Terrain, Valley, Goo, Flower, Rain, Amoeba, Lightning, Tree, Stereo:** Organic and generative simulations reacting to frequency bands.

### 🎥 Broadcast & Streaming Ready (OBS Studio)
* **Chroma Key Support:** Toggle between Solid Black, Chroma Green (for streaming keying), and Transparent backgrounds.
* **Clean Mode:** URL parameter `?clean` strips all UI controls for seamless OBS Browser Source capture.
* **Separate controls and display:** open the server's address for the controls, and click **Open display in another tab** to start the display (or use it as an OBS Browser Source). The controls work from any browser or device. See [Display and controls as two pages](#display-and-controls-as-two-pages).
* **Copy OBS Link:** Single-click button copies a browser-source URL preserving the active visual, input device, and background mode.

---

## Getting Started

Because browsers require a secure context (HTTPS or `localhost`) to access microphone and audio inputs, run the project through a local server.

### Prerequisites
* Modern web browser with Web Audio API support (Chrome, Firefox, Edge, Safari).
* Python 3 (for the local HTTPS development server).
* Node.js & Chrome/Chromium (optional, for headless motion tests).

### Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/RossT76/music-graphic.git
   cd music-graphic
   ```

2. **Start the local server:**
   You can run any static HTTP/HTTPS server:
   ```bash
   # Using Python's built-in HTTP server:
   python3 -m http.server 8000
   ```
   Or use the included `serve.py` (which serves over HTTPS if you have a local certificate setup in `~/.config/music-graphic`):
   ```bash
   python3 serve.py 8443
   ```

3. **Open in your browser:**
   * Navigate to `http://localhost:8000` (or `https://localhost:8443`).
   * Choose your audio input device in the control bar.
   * Click **Listen** to begin real-time audio analysis.

---

## Keyboard Controls & URL Parameters

### Keyboard Shortcuts
| Key | Action |
| --- | --- |
| `←` / `→` | Switch to previous / next visual |
| `B` | Cycle background (Black &rarr; Green &rarr; Transparent) |
| `F` | Toggle fullscreen |
| `[` / `]` | Slower / faster (0.25&times;&ndash;3&times;) |
| `R` | Reverse direction |
| `0` | Reset speed and direction |

Speed and Reverse apply to the visuals where they mean something (Radial, Particles, Tunnel, Kaleidoscope, Terrain, Valley, Goo, Flower, Rain, Amoeba, Hypno, Skull, X-ray Skull); the Motion controls dim for the rest. Reverse spins things the other way, flies backwards through the tunnel or valley, makes particles stream inward, lets rain rise, rolls the terrain towards you, sends the amoeba's ripples inward, and makes the skull sweep the other way first. The skull's jaw always follows the beat, not the Speed slider.

**Auto reverse** (on the controls page, under Reverse) flips the direction by itself, on the beat, every 8, 16, 32 or 64 beats (at 120 BPM, 32 beats is about 16 seconds). It only flips while music is playing and the current visual has motion. An automatic flip eases through zero over half a second, like a record spinning back; pressing Reverse yourself is still instant and restarts the countdown. The Reverse button follows along, so you can always see which way it is going.

### URL Parameters
* `?visual=<name>` — Load directly into a specific visual (e.g., `?visual=dancer`).
* `?clean` — Hide all UI controls (ideal for OBS Browser Sources).
* `?output` — On `display.html`: clean, and controlled from `controls.html` through `serve.py` (see below).
* `?bg=black|green|transparent` — Set default background.
* `?device=<name>` — Pre-select an audio input device matching a keyword.
* `?speed=<0.25-3>` — Set the motion speed multiplier (default 1).
* `?reverse` — Start with the motion direction reversed.
* `?move=<lower>,<upper>` — Pin the dancer to specific routines for testing (e.g., `?move=step,jack ripple`).

---

## Display and controls as two pages

The page that draws the visual can run with no controls at all, while a second page controls it. They talk through `serve.py`, so this needs `serve.py` (a plain static server won't do) and nothing else to install.

* **Controls:** `https://<server>:8443/`. The main address. It has the visual picker, speed and reverse, background, input device, sensitivity and noise gate, a live level meter, and the display's address for OBS. The status badge says whether a display is running and what it is hearing. Open it in any browser, on a phone, or as an OBS custom dock.
* **Display:** the **Open display in another tab** button on the controls page opens `https://<server>:8443/display.html?output`. It starts listening by itself and shows only the visual. Clicking the button again brings that tab forward instead of opening a second one. A browser pauses drawing in a tab you aren't looking at, so while the display tab is in the background the picture freezes and its meters stop moving (it still counts as running, and any change you make is applied when you switch back). To watch it while you work on the controls, drag the display tab into its own window, on a second screen for instance. For OBS, paste the same address into a Browser Source instead; OBS keeps drawing it.
* Older links still work: `controls.html` redirects to the main address, and any link with parameters such as `index.html?clean&visual=rain` goes straight to the display page with them.

* **Debug:** the Debug section at the bottom of the controls page has an On/Off switch. While it is on, the display sends what it is hearing and doing, and the controls show it: beat lock, beats detected, tempo and the beat clock, pulse clarity, every level (loudness, bass, mid, treble, sub-bass, highs, punch, snap), the frame rate (or "paused" if the display tab is in the background), screen size, speed and direction, the input and the audio state, plus a section of the current visual's own details (the dancer shows its state, moves, mood and phrase). **Copy details** puts a plain-text version on the clipboard for pasting into a bug report. Nothing is drawn on the display itself, and nothing extra is sent while it is off. A visual can add its own lines with a `debug` function (see `registry.js`). The older `?debug` text overlay on the dancer still works on `display.html` without `?output`.

How it works: the controls post changes to `serve.py`, which keeps them in `~/.config/music-graphic/state.json` and pushes them to the output over a server-sent events stream. The display reports its status (listening, BPM, levels, the visuals and inputs on offer) back through the server, so the controls page needs no list of its own: a new visual appears in it automatically. The server's settings win over URL parameters and saved choices in `?output` mode, and a freshly started output picks up where it left off. Keyboard shortcuts are off in `?output` mode, so the two pages can't disagree.

There is no login: anyone who can reach the server's port can change the settings. `display.html` without `?output` still works on its own, with its built-in control bar, with or without `serve.py`.

---

## Automated Motion & Choreography Testing

The repository includes a headless automated test harness (`tests/motion-check.mjs`) that evaluates the procedural dancer inside headless Chromium without needing manual visual inspection:

```bash
node tests/motion-check.mjs
```

### What It Measures:
* **Kinematic Beat Hit (`beatHit`):** Verifies that joint kinetic velocity reaches a local minimum within 50 ms of the beat.
* **Foot Slide (`footSlide`):** 95th-percentile horizontal velocity of planted feet (must remain $< 0.05$ body-heights/sec).
* **Center-of-Mass Balance (`comOutside`):** Verifies that the horizontal projection of the Center of Mass stays bounded within the Base of Support during ground contact.
* **Leg Reach (`overReach`):** Verifies foot targets never exceed anatomical reach limits.
* **Lead Scale Optimization:** Sweeps lead-time scaling to ensure spring lag compensation is calibrated.

---

## Theoretical Background

The procedural animation engine is grounded in biomechanical and cognitive movement research, specifically:
* **Neurocognitive Entrainment:** Mapping sub-bass (50–100 Hz) to saccular-vestibular balance reflexes (knee bounce, vertical CoM excursion) and high frequencies (6.4–12.8 kHz) to distal articulation (Burger et al., *"Influences of Rhythm- and Timbre-Related Musical Features on Characteristics of Music-Induced Movement"*).
* **Kinematic Beat Formalism:** Modeling choreographic beats as local kinetic velocity minima ($v_{\text{kinetic}} \to 0$ via muscular co-contraction) rather than peak displacement.
* **Laban Movement Analysis (LMA):** Weight and Suddenness effort factors mapped to spring stiffness and envelope derivatives.
* **Dynamic Equilibrium:** Real-time Center-of-Pressure (CoP) and Base-of-Support (BoS) constraints to guarantee zero foot-skating and physically plausible weight transfers.

---

## License

MIT License. Feel free to use, modify, and integrate into live performances or streaming setups.
