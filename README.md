# ◐ Tendies Studio

**A dark-mode studio for animated iOS lock screen wallpapers.** Design PosterBoard wallpapers right on your iPhone (or any computer) and export `.tendies` for Placard, Pocket Poster, AirCard, Nugget & co.

Runs entirely in the browser as an installable web app (PWA): nothing to install, no server, works offline, your projects stay on your device.

## What it does

| | |
|---|---|
| **Two export formats** | **Modern** – ParameterizedCA for iOS 26/27: values *follow your finger* while you swipe up/pull down, gyro parallax, iOS 27 depth fix. **Classic** – LayeredAnimation for iOS 17+: spring transitions, Light/Dark variants. |
| **Layers** | Image, GIF, video, text (custom TTF/OTF fonts), gradient, color, shapes, **Glass** (Frosted / Liquid Glass / live blur), particles, image sequences |
| **Depth** | Behind the clock / in front of the clock (depth effect) |
| **Swipe & states** | Lock · Home · Always-On – position, scale, rotation, opacity per state; 14 one-tap swipe effects |
| **Gyro parallax** | Per-layer depth, preview with the mouse or the phone's motion sensor |
| **Animations** | Any number per layer: float, bounce, drift, pulse, heartbeat, spin, sway, wiggle, breathe, blink or your own keyframes – loop or play once, easing, phase |
| **Style** | 16 blend modes, blur, hue, saturation, contrast, corner radius |
| **GIFs** | Built-in GIPHY / Tenor search (incl. transparent stickers) and GIF file import with exact timing |
| **Video** | Video → frame sequence (≤ 400 frames) with trim, fps, resolution, boomerang |
| **Live preview** | Real lock screen simulation: clock, swipe-to-unlock, home screen, AOD, tilt. Scrub the unlock with a slider. |
| **Checks** | Battery warning for endless animations, memory estimate, AOD depth hint, missing assets |
| **More** | Undo/redo, autosave, library, templates, collections (several wallpapers in one file), Nugget `.batter` templates, import & edit existing `.tendies` |

## Use it

**Online:** enable GitHub Pages (repo → Settings → Pages → Source: *GitHub Actions*); every push to `main` deploys. On iPhone open it in Safari → Share → *Add to Home Screen*.

**Locally:**

```bash
npm start          # http://localhost:8080
```

### Getting the wallpaper onto your iPhone

1. **Export** → choose *Modern* (iOS 26/27) or *Classic* → the share sheet opens (save to Files or send to an installer).
2. Install with **Placard**, **Pocket Poster** or **AirCard** on-device (for iOS 27 depth use AirCard's *Depth Test* build – it keeps the hidden options file), or **Nugget / GoldenNugget** from a computer.
3. Long-press the lock screen → **+** → **Collections** → your wallpaper.

> Custom PosterBoard wallpapers are not an official Apple feature; which installer works depends on your iOS version and the currently available exploit.

### GIF search

GIPHY and Tenor require a free API key. Paste it once in *Settings* – it is stored only in your browser and sent only to that provider.

## Tips

- Pick a state (Lock / Home / Always-On) and move things on the canvas – that's how swipe animations are made. Orange = editing a state, blue = base values.
- Prefer swipe effects over endless loops: an endlessly animating wallpaper keeps the screen redrawing (measured ~30% vs ~4% CPU idle).
- Always-On has no depth effect – keep subjects below the clock in AOD.
- Keyboard: `P` preview · `Space` play unlock · `1/2/3` states · arrows nudge (⇧ = 10 pt) · `⌘Z / ⇧⌘Z` · `⌘D` duplicate · `⌫` delete · `⌘S` export.

## Development

Plain HTML/CSS/JavaScript modules – no dependencies, no build step.

```
index.html, styles.css, sw.js, manifest.webmanifest
src/core/      format logic (also runs in Node): model, caml, tendies, zip, plist, bplist, template-data
src/browser/   browser APIs: rasterising, IndexedDB, video frames, GIF decoder, GIF search, import
src/app/       UI: store (undo/autosave), preview, panels, actions, templates
tests/         core.test.mjs (Node), e2e.cjs (Playwright)
docs/FORMAT.md the .tendies / CAML format with sources
```

```bash
npm test                                             # export pipeline in Node
npm start & node tests/e2e.cjs http://localhost:8080/   # browser E2E (needs Playwright)
```

## Credits

Format knowledge from [CAPlayground](https://github.com/CAPlayground/CAPlayground), [tendies-wallpaper-skill](https://github.com/iceorange-dev/tendies-wallpaper-skill) (device-verified ParameterizedCA template, MIT – see `THIRD_PARTY_NOTICES.md`), [PosterLab](https://github.com/gerdaroot/Poster-Lab), [Placard](https://github.com/frs0n/placard), [Nugget](https://github.com/leminlimez/Nugget) and [Pocket Poster](https://github.com/leminlimez/Pocket-Poster). Details in [`docs/FORMAT.md`](docs/FORMAT.md).
