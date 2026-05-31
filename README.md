# Connect 4 · Neon Edition

> A futuristic two-player Connect 4 game built with vanilla HTML, CSS, and JavaScript.

---

## 🔗 Live Demo

**[▶ Play Now →](YOUR_LIVE_LINK_HERE)**

> Replace `YOUR_LIVE_LINK_HERE` with your deployed URL (e.g. GitHub Pages, Netlify, Vercel).

---

## ✨ Features

- **Two-player local gameplay** — take turns on the same device
- **Night / Day theme** — toggle between cyberpunk neon and clean light mode, persisted to localStorage
- **Animated disc drops** — physics-inspired drop animation with bounce easing
- **Win detection** — checks all 4 directions (horizontal, vertical, both diagonals)
- **Draw detection** — triggers when the board fills with no winner
- **Fireworks celebration** — canvas-based particle system on win
- **Board shake** — tactile shake animation on victory
- **Score tracking** — scores persist across rounds within a session
- **Statistics modal** — match history, win rates, streaks, and a ring chart
- **Sound engine** — Web Audio API synthesized sounds for drops, wins, draws, and UI clicks
- **Loading screen** — animated progress bar with status messages
- **Preview row** — shows where your disc will land before you drop it
- **Keyboard navigation** — full keyboard support (Arrow keys, WASD, Enter, Space)
- **Touch support** — optimized for iOS and Android with touchstart/touchend handling
- **Accessibility** — ARIA roles, live regions, focus management, screen reader support
- **Reduced motion** — respects `prefers-reduced-motion`

---

## 🎮 Controls

| Action | Input |
|---|---|
| Move cursor left | `←` or `A` |
| Move cursor right | `→` or `D` |
| Drop disc | `Enter` or `Space` |
| New game | `R` |
| Toggle theme | `T` |
| Toggle sound | `M` |
| Open statistics | `S` |
| Close modal | `Escape` |

---

## 🗂 Project Structure

```
├── index.html   — markup, semantic HTML, ARIA attributes
├── style.css    — design system, themes, animations, responsive layout
└── script.js    — game logic, rendering, input handling, sound, stats
```

### JavaScript Architecture

| Class / Module | Responsibility |
|---|---|
| `GameState` | Pure game logic — board, win/draw detection, scores. Zero DOM. |
| `Renderer` | All DOM reads and writes. Caches every element ref at construction. |
| `InputHandler` | Mouse, touch, and button events. Keyboard owned by `App`. |
| `App` | Orchestrator. Owns the single `keydown` listener. |
| `CelebrationSystem` | Canvas fireworks, board shake, winner glow. IIFE. |
| `SoundEngine` | Web Audio API synthesis. Lazy context, mute via GainNode ramp. |
| `StatsManager` | localStorage persistence with full type validation. |
| `StatsModal` | Statistics dashboard renderer. Tracks and cancels all RAF animations. |
| `ThemeManager` | Day/night toggle with localStorage and OS preference fallback. IIFE. |

---

## 🚀 Getting Started

No build tools or dependencies required.

```bash
# Clone the repo
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Open directly in your browser
open index.html
```

Or just drag `index.html` into any browser.

---

## 🛠 Tech Stack

- **HTML5** — semantic markup, ARIA accessibility
- **CSS3** — custom properties, `clamp()`, `backdrop-filter`, CSS animations, `@keyframes`
- **Vanilla JavaScript (ES2022)** — classes, async/await, Web Audio API, Canvas API, ResizeObserver
- **Google Fonts** — Orbitron, Rajdhani, Inter

No frameworks. No dependencies. No build step.

---

## 📋 Browser Support

| Browser | Support |
|---|---|
| Chrome 90+ | ✅ Full |
| Firefox 90+ | ✅ Full |
| Safari 15+ | ✅ Full |
| Edge 90+ | ✅ Full |
| iOS Safari 15+ | ✅ Full |
| Android Chrome | ✅ Full |

---

## 📄 License

MIT — free to use, modify, and distribute.
