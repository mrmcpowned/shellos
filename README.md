# 🐚 ShellOS v1.0

A retro computing simulator featuring a Classic Mac OS-style windowed desktop environment with full CRT visual effects, barrel distortion, and interactive applications.

**[Live Demo →](https://mrmcpowned.github.io/shellhacks-x/)**

## Features

### Desktop Environment
- Classic Mac OS-style windowed UI with striped title bars, close boxes, and menu bar
- Draggable and resizable windows via react-rnd
- Window management: focus (z-order), minimize, active/inactive states
- Desktop icons with double-click to open (single tap on mobile)
- Click desktop to deactivate all windows
- Persistent settings saved to localStorage

### Applications
- **Terminal** — 17+ built-in commands including `dir`, `cat`, `cd`, `neofetch`, `cowsay`, `matrix`
- **File Explorer** — Browse a real filesystem defined in `src/filesystem/` (bundled at build time via Vite `import.meta.glob`)
- **Text Editor** — Open and edit text files from File Explorer or Terminal
- **Snake** — Classic snake game with keyboard and touch controls
- **Settings** — CRT intensity, terminal color, desktop pattern, sound, screensaver, quick boot toggle
- **About ShellOS** — System info dialog with ASCII conch shell art

### CRT Effects
- **Barrel distortion** — Real geometric distortion via SnapDOM capture → Three.js WebGL shader (bilinear sampling, perfectly smooth)
- **Defocus bloom** — Warm phosphor glow from neighbor pixel sampling
- **Scanlines** — Subtle brightness modulation
- **Chromatic aberration** — Color fringing at screen edges
- **Flicker** — Barely perceptible brightness oscillation
- **Power-on animation** — Electric jolt: dot → line → full screen with brightness flash and static burst

### Performance
- Variable refresh rate capture: 60fps during interaction, down to 2fps when idle
- Animation-aware scheduling: higher capture rate when terminal or snake is open
- Texture reuse to prevent GPU allocation churn
- ResizeObserver for layout-thrash-free dimension tracking

### Boot Sequence
- BIOS POST with ASCII conch shell art animation
- CPU detection, memory count (640K), drive detection
- Tone.js synthesized boot sounds (POST beep, memory clicks, drive seek, success chime)
- "Press any key to skip" + configurable Quick Boot on return visits
- Smooth shader-driven boot-to-desktop transition

### Additional Features
- System error dialogs (💣 bomb icon, random crashes)
- Screensaver (starfield or bouncing logo)
- Shutdown sequence with confirmation dialog
- UI sounds (window open/close, menu click, error beep, keystrokes)
- Custom DOM cursor that follows barrel distortion
- Mobile responsive layout
- `prefers-reduced-motion` support

## Tech Stack

| Technology | Purpose |
|-----------|---------|
| React 19 + TypeScript | UI framework |
| Vite 8 | Build tool |
| Three.js | WebGL barrel distortion + CRT shader |
| @zumer/snapdom | DOM-to-canvas capture for WebGL pipeline |
| react-rnd | Window drag and resize |
| framer-motion | Boot text animations |
| Tone.js | Audio synthesis (boot sounds, UI sounds) |
| Space Mono | System UI font |
| VT323 | Terminal font |

## Filesystem

The in-app filesystem is defined by real files in `src/filesystem/`. Add, edit, or remove files there — Vite bundles them at build time via `import.meta.glob`, no code changes needed.

```
src/filesystem/
├── Applications/
│   └── about.txt
├── Documents/
│   ├── readme.txt
│   └── notes.txt
└── System/
    ├── config.sys
    └── version.txt
```

## Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Type check
npx tsc -b
```

> Requires Node.js 20.19+ or 22.12+

## Deployment

Deployed automatically to GitHub Pages via GitHub Actions on push to `main`.

## License

See [LICENSE](LICENSE).
