# Das `.tendies`-Format – Referenz

Apple dokumentiert PosterBoard-Wallpaper nicht öffentlich. Dieses Dokument fasst zusammen, was Tendies Studio erzeugt, und woher jedes Detail stammt:

- **[A] Apple, Core Animation** (offizielle Doku): `CALayer`, `CAKeyframeAnimation`, `CASpringAnimation`, `CAEmitterLayer`, *Key-Value Coding Extensions* (Key-Paths wie `position.x`, `transform.scale`, `transform.rotation.z`), Koordinatensystem (iOS: Ursprung oben links).
- **[N] Nugget** `documentation.md`, `tendie_file.py`, `posterboard_tweak.py`, `video_handler.py` und die Vorlage `files/posterboard/VideoCAML` (github.com/leminlimez/Nugget).
- **[P] Pocket Poster** (github.com/leminlimez/Pocket-Poster).
- **[C] Community-Wallpaper**, auf iOS 27 getestet (z. B. github.com/xxzhil/unlock-tendies): Zustandsmaschine *Locked/Unlock/Sleep × Light/Dark* mit `CASpringAnimation`.
- **[W] The Apple Wiki** – `Filesystem:/Applications/PosterBoard.app` (Hintergrund zu PosterBoard).

## Archiv

Eine `.tendies`-Datei ist ein ZIP. Tools erkennen zwei Layouts [N]:

| Ordner | Ziel | IDs |
|---|---|---|
| `descriptors/` (oder `descriptor/`) | `…/PRBPosterExtensionDataStore/<61\|59>/Extensions/com.apple.WallpaperKit.CollectionsPoster/descriptors` | UUID + Wallpaper-ID werden beim Installieren zufällig neu vergeben |
| `ordered-descriptors/` | wie oben, Reihenfolge bleibt erhalten (absteigende IDs) | – |
| `container/` | direkt in den PosterBoard-Container | unverändert (riskant) |

Tendies Studio verwendet `descriptors/` bzw. für Sammlungen `ordered-descriptors/`. Nugget erlaubt max. 10 Descriptoren pro Vorgang [N].

## Descriptor

```
descriptors/<UUID>/
  com.apple.posterkit.role.identifier                 PRPosterRoleLockScreen
  com.apple.posterkit.provider.descriptor.identifier  <Wallpaper-ID>
  providerInfo.plist                                  NSKeyedArchiver {kConfigurationLastUseDateKey: NSDate}
  versions/1/contents/
    com.apple.posterkit.provider.contents.userInfo    {wallpaperRepresentingFileName, wallpaperRepresentingIdentifier, posterEnvironmentOverrides}
    <ID>.<Name>-<Screen>.wallpaper/
      Wallpaper.plist
      <ID>.<Name>_Background-<Screen>.ca/
      <ID>.<Name>_Floating-<Screen>.ca/
      <ID>.<Name>_Foreground-<Screen>.ca/
```

Entspricht der Nugget-Vorlage `VideoCAML` [N] bzw. den Community-Dateien [C]. `<Screen>` ist die *logicalScreenClass*, z. B. `402w-874h@3x~iphone`.

### Wallpaper.plist

```
appearanceAware   Bool
assets.lockAndHome.default:
  type                           LayeredAnimation
  backgroundAnimationFileName    …_Background-….ca
  floatingAnimationFileNameKey   …_Floating-….ca      (sic, Schlüssel endet auf "Key")
  foregroundAnimationFileName    …_Foreground-….ca
  identifier, name
identifier, name, family, logicalScreenClass, version, contentVersion, preferredProminentColor
```

## `.ca`-Paket

```
main.caml           Ebenenbaum (Core Animation XML)
index.xml           Plist: rootDocument=main.caml, documentWidth/Height …
assetManifest.caml  <MicaAssetManifest> (leer)
assets/             PNG/JPEG
```

### main.caml – was Tendies Studio schreibt

```xml
<caml xmlns="http://www.apple.com/CoreAnimation/1.0">
  <CALayer id="root-floating" bounds="0 0 W H" position="W/2 H/2" geometryFlipped="0">
    <sublayers>
      <!-- äußere Ebene: Geometrie + Zustandswerte -->
      <CALayer id="L…" bounds="0 0 w h" position="x y" opacity="1">
        <sublayers>
          <!-- innere Ebene: Inhalt + Loop -->
          <CALayer id="L…-content" contentsGravity="resizeAspectFill" masksToBounds="1">
            <contents><CGImage src="assets/L….png"/></contents>
            <animations>
              <animation type="CAKeyframeAnimation" keyPath="position.y" calculationMode="cubic"
                         beginTime="1e-100" duration="3" repeatCount="inf" autoreverses="1" removedOnCompletion="0">
                <values><real value="437"/><real value="425"/></values>
              </animation>
            </animations>
          </CALayer>
        </sublayers>
      </CALayer>
    </sublayers>
    <states>
      <LKState name="Unlock"><elements>
        <LKStateSetValue targetId="L…" keyPath="opacity"><value type="real" value="1"/></LKStateSetValue>
      </elements></LKState>
      …
    </states>
    <stateTransitions>
      <LKStateTransition fromState="*" toState="Unlock"><elements>
        <LKStateTransitionElement targetId="L…" key="opacity">
          <animation type="CASpringAnimation" damping="50" mass="2" stiffness="300" duration="0.8"
                     fillMode="backwards" keyPath="opacity" mica_autorecalculatesDuration="1"/>
        </LKStateTransitionElement>
      </elements></LKStateTransition>
    </stateTransitions>
  </CALayer>
</caml>
```

Designentscheidungen:

- **Alles wird zu Bitmaps gerastert** (Text, Verläufe, Formen). Ein `CALayer` mit `CGImage`-Inhalt ist das, was PosterBoard nachweislich auf allen Versionen rendert [C][N].
- **Zwei Ebenen pro Layer**: Die äußere trägt die Zustandswerte, die innere den Loop. So können Zustand und Loop dieselbe Eigenschaft animieren, ohne sich zu überschreiben.
- **Zustände**: Immer `Locked`, `Unlock`, `Sleep` [N]; mit Hell/Dunkel zusätzlich `Locked Light` … `Sleep Dark` [C]. PosterBoard wählt den Zustand selbst.
- **Key-Paths** aus Apples KVC-Erweiterungen [A]: `opacity`, `position.x`, `position.y`, `transform.scale`, `transform.rotation.z` (Radiant).
- **Grund-Drehung/-Skalierung** werden als Zustandswerte geschrieben (statt als `transform`-Matrix), weil deren CAML-Serialisierung nicht belegt ist.
- **Video**: `CAKeyframeAnimation` auf `contents` mit einer `CGImage`-Liste, `calculationMode="discrete"`, max. 400 Frames – wie Nugget [N].
- **Koordinaten**: Punkte (nicht Pixel), Ursprung oben links (iOS-Standard [A]), Assets in @3x.
- **Partikel** (`CAEmitterLayer`/`CAEmitterCell`) folgen den Property-Namen aus [A]; in der Community kaum erprobt → als experimentell markiert.

## Nugget-Vorlagen (`.batter`)

ZIP mit `config.json` + `descriptors/…` [N]. Tendies Studio erzeugt für jede als „In Nugget anpassbar“ markierte Ebene:

- `replace` – Bild austauschen (nur Bild-Ebenen),
- `set` / `slider` – `opacity` über `nuggetId`,
- `set` / `toggle` – `hidden`.

`format_version: "2"`, `domain: "AppDomain-com.apple.PosterBoard"`.

## Bekannte Grenzen

- PosterBoard-Wallpaper sind kein offizielles Apple-Feature; Installer hängen von der iOS-Version ab.
- Auf dem Gerät erzeugt PosterBoard Parallax/Perspektive selbst – die Vorschau zeigt sie nicht.
- Import liest Bild-/Video-Ebenen und Zustandswerte; Partikel, Loops und Script-Komponenten fremder Dateien werden nicht übernommen.
