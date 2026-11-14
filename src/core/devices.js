// Logical screen sizes in points (UIScreen.bounds) + native scale.
// PosterBoard names a wallpaper by its "logicalScreenClass", e.g. "393w-852h@3x~iphone".
// PosterBoard scales a CA document to the screen, so a mismatched class still works,
// but matching the device gives pixel-perfect placement.
export const DEVICES = [
  { id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max / 16 Pro Max', w: 440, h: 956, scale: 3 },
  { id: 'iphone-air', name: 'iPhone Air', w: 420, h: 912, scale: 3 },
  { id: 'iphone-17-pro', name: 'iPhone 17 / 17 Pro / 16 Pro', w: 402, h: 874, scale: 3 },
  { id: 'iphone-15-pro-max', name: 'iPhone 16 Plus / 15 Pro Max / 15 Plus / 14 Pro Max', w: 430, h: 932, scale: 3 },
  { id: 'iphone-16', name: 'iPhone 16 / 15 / 15 Pro / 14 Pro', w: 393, h: 852, scale: 3 },
  { id: 'iphone-16e', name: 'iPhone 16e / 14 / 13 / 12', w: 390, h: 844, scale: 3 },
  { id: 'iphone-14-plus', name: 'iPhone 14 Plus / 13 Pro Max / 12 Pro Max', w: 428, h: 926, scale: 3 },
  { id: 'iphone-13-mini', name: 'iPhone 13 mini / 12 mini / 11 Pro / XS / X', w: 375, h: 812, scale: 3 },
  { id: 'iphone-11', name: 'iPhone 11 / XR', w: 414, h: 896, scale: 2 },
  { id: 'iphone-11-pro-max', name: 'iPhone 11 Pro Max / XS Max', w: 414, h: 896, scale: 3 },
  { id: 'iphone-se', name: 'iPhone SE (2./3. Gen) / 8', w: 375, h: 667, scale: 2 },
  { id: 'iphone-8-plus', name: 'iPhone 8 Plus', w: 414, h: 736, scale: 3 },
  { id: 'ipad-11', name: 'iPad Pro 11" / Air 11"', w: 834, h: 1194, scale: 2, ipad: true },
  { id: 'ipad-13', name: 'iPad Pro 13" / Air 13"', w: 1032, h: 1376, scale: 2, ipad: true },
  { id: 'ipad-10', name: 'iPad (10./11. Gen)', w: 820, h: 1180, scale: 2, ipad: true },
  { id: 'ipad-mini', name: 'iPad mini (6./7. Gen)', w: 744, h: 1133, scale: 2, ipad: true },
];

export const getDevice = (id) => DEVICES.find((d) => d.id === id) || DEVICES[2];

export const screenClass = (d) => `${d.w}w-${d.h}h@${d.scale}x~${d.ipad ? 'ipad' : 'iphone'}`;

/** Best effort guess of the current device from the browser viewport (for iPhone users). */
export function guessDevice() {
  if (typeof screen === 'undefined') return DEVICES[2].id;
  const w = Math.min(screen.width, screen.height);
  const h = Math.max(screen.width, screen.height);
  const dpr = Math.round(globalThis.devicePixelRatio || 3);
  const hit = DEVICES.find((d) => d.w === w && d.h === h && d.scale === dpr) || DEVICES.find((d) => d.w === w && d.h === h);
  return hit ? hit.id : DEVICES[2].id;
}
