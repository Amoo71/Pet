# ◐ Tendies Studio

**Live-Wallpaper-Studio für das iOS PosterBoard.** Gestalte animierte Sperrbildschirme direkt auf dem iPhone (oder am Computer) und exportiere sie als `.tendies` – fertig für Nugget, Pocket Poster & Co.

Läuft komplett im Browser als installierbare Web-App (PWA): keine Installation, kein Server, offline nutzbar. Deine Projekte bleiben lokal auf deinem Gerät.

## Funktionen

| | |
|---|---|
| **Ebenen** | Bild, Video, Text (inkl. eigener TTF/OTF-Schriften), Verlauf (linear/radial/konisch), Farbe, Formen (Kreis, Rechteck, Stern, Polygon, Herz, Ring), Partikel, Bildfolgen |
| **3 Tiefenebenen** | Hintergrund · Floating · Vordergrund – genau wie Apples geschichtete Wallpaper (`LayeredAnimation`) |
| **Zustände** | 🔒 Gesperrt · 🔓 Entsperrt · 🌙 Ruhe (Always-On) – Position, Größe, Drehung und Deckkraft pro Zustand, PosterBoard animiert den Wechsel |
| **Hell/Dunkel** | Optionale `Light`/`Dark`-Varianten aller Zustände (folgt dem iOS-Erscheinungsbild) |
| **Übergänge** | Feder-Animationen (`CASpringAnimation`) mit Presets oder eigener Masse/Steifigkeit/Dämpfung, pro Projekt oder pro Ebene |
| **Loops** | Drehen, Pulsieren, Schweben, Pendeln, Treiben, Atmen, Blinken – kombinierbar mit Zuständen |
| **Video** | Video → Frame-Sequenz (bis 400 Frames, PosterBoard-Limit) mit Zuschnitt, Bildrate, Auflösung, Boomerang |
| **Partikel** | Schnee, Regen, Funkeln, Blasen, Glut, Blüten, Sterne (`CAEmitterLayer`, experimentell) |
| **Live-Vorschau** | Echte Sperrbildschirm-Simulation mit Uhr, Entsperr-Animation, Homescreen, AOD-Abdunklung |
| **Direkt bearbeiten** | Ziehen, Skalieren, Drehen per Touch oder Maus, Einrasten, Pfeiltasten, Rückgängig/Wiederholen |
| **Schnell-Effekte** | Ein Tipp: „beim Entsperren einblenden/zoomen/drehen“, „im Ruhemodus abdunkeln“, „nur im Dunkelmodus“ … |
| **Export** | `.tendies` (einzeln oder als geordnete **Sammlung** mehrerer Wallpaper), **Nugget-Vorlage** `.batter` mit anpassbaren Optionen |
| **Import** | Bestehende `.tendies` öffnen und weiterbearbeiten (Bilder, Videos, Zustände) |
| **Geräte** | Alle iPhones von SE bis 17 Pro Max / Air sowie iPads, mit passender Screen-Klasse |
| **Vorlagen** | Sonnenaufgang, Tag & Nacht, Schneenacht, Neon-Puls, Foto-Reveal |

## Benutzen

**Online:** Nach dem Aktivieren von GitHub Pages (Repo → Settings → Pages → Source: *GitHub Actions*) wird das Studio bei jedem Push auf `main` automatisch veröffentlicht. Auf dem iPhone in Safari öffnen → Teilen → *Zum Home-Bildschirm*.

**Lokal:**

```bash
npm start          # http://localhost:8080
```

### Wallpaper aufs iPhone bringen

1. Im Studio **Export** tippen → Teilen-Menü → in *Dateien* sichern oder direkt an die Installer-App senden.
2. Installieren mit
   - **Nugget** (Computer, USB): *Posterboard* → `.tendies` hinzufügen → *Apply*, oder
   - **Pocket Poster** bzw. einer anderen On-Device-App, je nach iOS-Version.
3. Sperrbildschirm lange drücken → **+** → **Sammlungen** → dein Wallpaper.

> Eigene PosterBoard-Wallpaper nutzen keine offizielle Apple-Schnittstelle. Welche Installer funktionieren, hängt von deiner iOS-Version ab. Bei Problemen in Nugget „Reset Collections“ ausführen und neu anwenden.

## Bedienung

- **Zustand wählen** (unten): Was du jetzt verschiebst/skalierst, wird für diesen Zustand gespeichert (oranger Rahmen). Im Zustand *Gesperrt* bearbeitest du die Grundwerte (blauer Rahmen).
- **▶︎ Entsperren** spielt die Entsperr-Animation ab.
- Mehrmals auf dieselbe Stelle tippen wählt die Ebene darunter.
- Tastatur: `1`/`2`/`3` Zustände · Pfeile verschieben (⇧ = 10 pt) · `⌘Z`/`⇧⌘Z` · `⌘D` duplizieren · `⌫` löschen · `⌘S` exportieren.
- Bilder und `.tendies` lassen sich per Drag & Drop oder Einfügen hinzufügen.

## Entwicklung

Reines HTML/CSS/JavaScript (ES-Module), keine Abhängigkeiten, kein Build-Schritt.

```
index.html, styles.css, sw.js, manifest.webmanifest
src/core/      Format-Logik (läuft auch in Node): model, caml, tendies, zip, plist, devices
src/browser/   Browser-APIs: Rasterisierung, IndexedDB, Video-Frames, Import
src/app/       Oberfläche: store (Undo/Autosave), preview, panels, actions, templates
tests/         core.test.mjs (Node), e2e.cjs (Playwright)
docs/FORMAT.md Aufbau von .tendies / CAML – mit Quellen
```

```bash
npm test                                   # Export-Pipeline in Node
npm start & node tests/e2e.cjs http://localhost:8080/   # Browser-E2E (benötigt Playwright)
```

## Danksagung

Das Dateiformat folgt der Arbeit von [Nugget](https://github.com/leminlimez/Nugget) und [Pocket Poster](https://github.com/leminlimez/Pocket-Poster) (leminlimez), der PosterRestore-Community und auf Geräten getesteten Community-Wallpapern. Details und Quellen in [`docs/FORMAT.md`](docs/FORMAT.md).
