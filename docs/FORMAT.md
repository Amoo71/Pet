# The `.tendies` format – reference

Apple does not document PosterBoard wallpapers. This file records what Tendies Studio writes and where every detail comes from.

**Sources**

- **[A] Apple – Core Animation** (official docs): `CALayer`, `CAKeyframeAnimation`, `CASpringAnimation`, `CAEmitterLayer`, key-value coding extensions (`position.x`, `transform.scale`, `transform.rotation.z` …).
- **[K] tendies-wallpaper-skill** (iceorange-dev, MIT): ParameterizedCA engine + ~50 techniques, many **verified on iPhone (iOS 27)**, incl. measured battery usage. Our ParameterizedCA metadata comes from its template.
- **[C] CAPlayground** – open-source web CA editor: CAML serializer for all layer types, Liquid Glass, filters, blend modes, gyro export.
- **[L] PosterLab** (gerdaroot) – on-device editor writing ParameterizedCA; documents the y-up flip.
- **[P] Placard** (frs0n, fork cxk203) – iOS 26–27 installer + video wallpapers (LayeredAnimation, ≤ 12 s).
- **[N] Nugget / Pocket Poster** (leminlimez) – original tendies/batter format docs.
- **[W] The Apple Wiki** – PosterBoard background.

## Two wallpaper types

| | Modern – `ParameterizedCA` | Classic – `LayeredAnimation` |
|---|---|---|
| Bundles | one `.ca` | `_Background`, `_Floating`, `_Foreground` `.ca` |
| States | `wallpaperPropertyGroups`: `v_lock`, `v_home`, `v_sleep` per (layer **name**, keyPath) | `LKState` `Locked` / `Unlock` / `Sleep` (+ `… Light` / `… Dark`) per layer **id** |
| Transition | **linear interpolation following the swipe** (no spring) [K] | `CASpringAnimation` after the state is reached [K][C] |
| Gyro | `wallpaperParallaxGroups` ✅ | lost on iOS 27 [K] |
| Depth (iOS 27) | bundle name must contain `Clownfish` + rendering configuration [K] | – |
| Light / Dark | unknown | `Locked Light` … `Sleep Dark` ✅ [C][community files] |

## Modern package (what we write)

```
descriptors/<UUID>/                       UUID + identity derived from a SHA-256 of the content
  com.apple.posterkit.role.identifier     PRPosterRoleLockScreen
  com.apple.posterkit.provider.descriptor.identifier   <ident>
  com.apple.posterkit.provider.identifierURL.suggestionMetadata.plist   gallery id + "<ident>.DYNAMIC"
  providerInfo.plist
  versions/0/
    com.apple.posterkit.provider.instance.renderingConfiguration.plist  depthEffectDisabled = motionEffectsDisabled = false
    com.apple.posterkit.provider.instance.complicationLayout.plist
    com.apple.posterkit.provider.instance.titleStyleConfiguration.plist
    supplements/0/com.apple.posterkit.provider.supplementURL.homescreenConfiguration.plist
    contents/
      .com.apple.posterkit.provider.contents.configurableOptions.plist  hidden file! preferredRenderingConfiguration
      com.apple.posterkit.provider.contents.otherMetadata.plist
      com.apple.posterkit.provider.contents.userInfo
      7400.WWDC_2022-390w-844h@3x~iphone.wallpaper/
        Wallpaper.plist          type ParameterizedCA, assetFileName, wantsDeviceMotion, logicalScreenClass "any"
        <ident>.Clownfish_Gyro.ca/{main.caml, index.xml, assetManifest.caml, assets/…}
```

Everything except `main.caml`, assets, `Wallpaper.plist`, `userInfo`, the descriptor identifier and the two strings in `suggestionMetadata` is copied byte-for-byte from the device-verified template [K]. Installers that drop hidden files lose the depth effect on iOS 27 [K].

### main.caml (modern)

```xml
<caml xmlns="http://www.apple.com/CoreAnimation/1.0">
  <CALayer id="__capRootLayer__" name="Root Layer" bounds="0 0 W H" position="W/2 H/2" geometryFlipped="0">
    <style>
      <wallpaperBackgroundAssetNames type="NSArray"/>
      <wallpaperFloatingAssetNames type="NSArray"/>
      <wallpaperParallaxGroups type="NSArray">
        <NSDictionary>   <!-- one per axis -->
          <axis type="string" value="x"/><image type="string" value="null"/>
          <keyPath type="string" value="transform.translation.x"/>
          <layerName type="string" value="Sun Parallax"/>
          <mapMaxTo type="integer" value="8"/><mapMinTo type="integer" value="-8"/>
          <title type="string" value="Gyro"/><view type="string" value="Background"/>
        </NSDictionary>
      </wallpaperParallaxGroups>
      <wallpaperPropertyGroups type="NSArray">
        <NSDictionary>
          <image type="null"/><keyPath type="string" value="position.y"/>
          <layerName type="string" value="Sun"/>
          <v_home type="real" value="384"/><v_lock type="real" value="44"/><v_sleep type="real" value="44"/>
          <view type="string" value="Background"/>
        </NSDictionary>
      </wallpaperPropertyGroups>
    </style>
    <sublayers>
      <CALayer id="background" name="BACKGROUND" …> … </CALayer>   <!-- under the clock -->
      <CALayer id="floating" name="FLOATING" …> … </CALayer>       <!-- over the clock (depth) -->
    </sublayers>
  </CALayer>
</caml>
```

Verified state key paths [K]: `opacity`, `position.x`, `position.y`, `transform.scale.xy`, `transform.rotation.z` (radians), `hidden`. Opacity outside 0–1 is clamped.

## iPhone Duo (iOS 27 split-screen schema) [K]

Apple's own Duo wallpaper (Clownfish-V68) layout, device-verified by [K]:

- Root `6000 × 6000`, one root unit = one device pixel, centred on each screen, y up.
- `<style>` holds `<wallpapers type="NSArray">` with one dictionary per screen (cover first): `backgroundLayerName` / `floatingLayerName` (`BACKGROUND TWO` / `FLOATING TWO` = cover, `… ONE` = inner), their own `…ParallaxGroups` and `…PropertyGroups`, and Apple's screen numbers (`idealWidth/Height`, `pixelWidth/Height`, `pixelParallaxBleed`, `pixelSquareWith(out)Parallax`, `retinaMultiplier`, `screenName`, `supportsLandscape`).
- Property groups have no `view` key and carry `portrait_lock/home/sleep` + `landscape_lock/home/sleep`.
- `Wallpaper.plist` needs `requiresLandscapeScaling = false`, otherwise the inner landscape is scaled up by 951/669.
- Tendies Studio designs one square scene (951 × 951 pt) and places it per screen inside a `Frame` layer with `transform="scale(3, 3, 1)"` – the cover shows a tighter crop, opening the phone feels like zooming out.

## Gyro beyond translation (experimental)

Only `transform.translation.x/y` parallax groups are device-verified [K]. Tendies Studio can additionally write parallax groups for:

- **3D tilt** – `transform.rotation.y` (axis x) and `transform.rotation.x` (axis y), `mapMin/MaxTo` in radians, on a `<name> Tilt` layer; planes get `sublayerTransform="perspective(N)"`.
- **Gyro fade** – `opacity` mapped to one tilt axis on a `<name> GyroFade` layer.

**Fast fade** (device-verified technique E4 [K]): the opacity state is written to two nested layers (`<name>` and `<name> Fade`) with √ values, so the visible opacity follows (1−u)² instead of a linear fade.

## One editor layer → CAML

```
[CATransformLayer "<name> Parallax"]   modern only, gyro target (full canvas)
  CALayer "<name>"  id=<layer id>      position, opacity, transform="rotate(…deg) scale(s, s, 1)",
                                        compositingFilter (blend), filters (blur/hue/saturate/contrast),
                                        state values target this layer
    CALayer "<name> Anim 1"            one nested layer per animation (CAKeyframeAnimation + keyTimes)
      CALayer "<name> Anim 2" …
        content: CALayer + CGImage | frame sequence | CAEmitterLayer | CABackdropLayer (glass)
```

- **Names are unique** – ParameterizedCA matches groups by name [K].
- **States and animations never share a layer**: an animation on the same layer + keyPath overrides the state value [K]. Nesting keeps both.
- **y axis points up**: CAML roots use `geometryFlipped="0"` → y = H − y, rotation = −rotation, emitter directions flipped [L][K][C].
- Loops: `beginTime="1e-100"`, `repeatCount="inf"`, `repeatDuration="inf"`; play-once: `repeatCount="1" fillMode="both"`. `position.x/y` values as `<integer>` [C].
- Frame sequences: `CAKeyframeAnimation keyPath="contents"` with `<CGImage>` values (frames may repeat for exact GIF timing), ≤ 400 frames [N].
- Blend modes: `<compositingFilter type="CAFilter" filter="screenBlendMode"/>` [C]; filters `gaussianBlur (inputRadius)`, `colorHueRotate (inputAngle)`, `colorSaturate / colorContrast (inputAmount)` [C].

### Glass

| Mode | CAML | Notes |
|---|---|---|
| Frosted (default) | blurred backdrop + tint + rim **baked into a PNG** at export | works on every iOS; doesn't follow layers that move behind it |
| Liquid Glass | `CABackdropLayer` + `displacementMap` filter (`inputSourceSublayerName="sdfLayer"`) + `CASDFLayer` with `CASDFGlassDisplacementEffect` + `CASDFElementLayer` (corner radius) [C] | iOS 26+, live refraction, experimental |
| Live blur | `CABackdropLayer` + `gaussianBlur` + `colorSaturate` filters | experimental |

A rim/tint/shine PNG is layered on top of Liquid Glass and Live blur.

## Classic package

`descriptors/<UUID>/versions/1/contents/<id>.<Name>-<screenClass>.wallpaper/` with `Wallpaper.plist` (`type LayeredAnimation`, `backgroundAnimationFileName`, `floatingAnimationFileNameKey` *(sic)*, `foregroundAnimationFileName`) and one `.ca` per plane, each with `LKState`/`LKStateTransition`. Every state lists every animated property (CAPlayground notes transitions break otherwise) [C]. Collections of classic wallpapers use `ordered-descriptors/` [N].

## Nugget templates (`.batter`)

`config.json` + descriptor tree [N]. Layers marked *Customizable in Nugget* get `nuggetId` and options: `replace` (images), `set`/`slider` (opacity), `set`/`toggle` (hidden).

## Performance (measured on device) [K]

| Wallpaper | backboardd CPU, idle |
|---|---|
| static | ~5 % |
| one 29 pt spinning star | ~26 % |
| full loop animations | 32–38 % |
| swipe-only motion (no loops) | ~4 % |

Anything that moves forever forces full redraws. Tendies Studio warns about loops, particles and multi-frame videos. Keep decoded image memory under ~80 MB.

## Limits & unknowns

- Not an official Apple feature; installers depend on iOS version and exploits.
- Liquid Glass, live blur and particles are written exactly like CAPlayground but have little device testing.
- Light/Dark in ParameterizedCA is not known to work, so it's Classic only.
- Import reads images, frame sequences, glass, blend/blur, states and parallax; particles, scripts and foreign animations are skipped.

## Apple's own 3D rig (iPhone 17 "Marble" wallpapers, reverse-engineered)

* `BACKGROUND` is a `CATransformLayer` (bounds 0, anchorPoint 0 0, position = screen centre).
* Each disc strip: `CATransformLayer _MAIN_TRANSFORM_n` → `CATransformLayer _GYRO_TRANSFORM_n` →
  `CALayer` (anchorPoint `0 0.5`, HEIC contents) with
  `transform="rotate(-θ, 0, 1, 0) scale(1/cos θ, 1, 1)"` (θ = 11.5°, 45.5°, 63.2°, 75.4°).
  The width compensation makes the steep strip look flat at rest.
* Gyro groups rotate the `_GYRO_TRANSFORM` layers: `transform.rotation.y` (axis x, ±0.122 rad) and
  `transform.rotation.x` (axis y, ±0.06…0.12 rad). Because the strip is already steep, a few
  degrees change its projected width a lot (cos(θ±δ)/cos θ) – visible without perspective
  (Apple uses `perspective(-1.29514e+24)`, i.e. orthographic).
* Gyro rotation must sit on a **CATransformLayer outside** the pre-rotated layer. Inside a plain
  `CALayer` the rotation is flattened first and stays invisible.

The studio exports gyro tilt / fold the same way: `CATransformLayer "<name> Tilt"` (bounds = screen,
anchorPoint = the layer's pivot) wraps the layer; `Duo 3D tilt` builds two pre-rotated halves
hinged on the centre line (`sx` = 1/cos θ) plus blurred copies that fade in on the side turning away.
Project perspective 0 = orthographic (no `sublayerTransform`).

## Apple's newest wallpapers (iPhone 17e / 18 Pro packs)

`Container/Library/Application Support/PRBPosterExtensionDataStore/61/Extensions/com.apple.MercuryPoster/descriptors/<UUID>/`
holds only metadata plists (providerInfo, descriptor.identifier, suggestionMetadata, …) – no
`.wallpaper`, no CAML. iOS renders them itself, so nothing can be added to their contents.

## Raw morph

For Apple's own ParameterizedCA wallpapers (HEIC, nested 3D rigs) Morph does not rebuild the
wallpaper: it keeps every file byte-for-byte and only inserts overlay layers (particles,
vignette) into the `FLOATING` group of the existing `main.caml` (`src/core/rawmorph.js`).
