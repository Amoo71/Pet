# Third-party notices

## tendies-wallpaper-skill (template metadata)

`src/core/template-data.js` contains PosterKit metadata files from the template of
<https://github.com/iceorange-dev/tendies-wallpaper-skill>, used under the MIT license:

```
MIT License

Copyright (c) 2026 iceorange-dev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## iphone-duo-fold-preview (jadon7) – MIT

`src/browser/duo-fold.js` (the `<duo-fold>` WebGL2 component used for the 3D iPhone Duo preview)
is inspired by https://github.com/254558/iphone-duo-fold-preview (MIT, jadon7): hinge fold with a
Hermite crease, fixed front-view projection, image-space blur and darkening.

## Mac-Duo (sumimakito) – Apache-2.0

The Duo 3D tilt effect (`src/app/effects.js`, `duoFarCopy` / `duoTiltLayers`) follows the iPhone Duo
fold model recreated in https://github.com/sumimakito/Mac-Duo (Copyright 2026 Makito, Apache License 2.0):
the picture turns back in perspective, blur = maxBlur·(floor + (1−floor)·h), dimming
(1 − maxDim·fade)^2.2 with fade = 0.2 + 0.8·smoothstep(0, reach, h). Formulas re-implemented, no code copied.
