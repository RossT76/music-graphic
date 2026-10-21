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
Includes 17 audio-reactive visuals in `visuals/`:
* **Dancer:** Procedural neon skeleton dancing in time with the music.
* **Bars, Radial, Particles, Scope, XY Scope:** Classic and oscilloscope-style frequency and waveform visualizers.
* **Tunnel, Kaleidoscope, Hypno:** Geometric, rhythmic hypnotic tunnels and symmetry patterns.
* **Terrain, Goo, Flower, Rain, Amoeba, Lightning, Tree, Stereo:** Organic and generative simulations reacting to frequency bands.

### 🎥 Broadcast & Streaming Ready (OBS Studio)
* **Chroma Key Support:** Toggle between Solid Black, Chroma Green (for streaming keying), and Transparent backgrounds.
* **Clean Mode:** URL parameter `?clean` strips all UI controls for seamless OBS Browser Source capture.
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

### URL Parameters
* `?visual=<name>` — Load directly into a specific visual (e.g., `?visual=dancer`).
* `?clean` — Hide all UI controls (ideal for OBS Browser Sources).
* `?bg=black|green|transparent` — Set default background.
* `?device=<name>` — Pre-select an audio input device matching a keyword.
* `?move=<lower>,<upper>` — Pin the dancer to specific routines for testing (e.g., `?move=step,jack ripple`).

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
