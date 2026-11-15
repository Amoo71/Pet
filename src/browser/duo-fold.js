/*!
 * <duo-fold> – foldable-phone fold effect as a dependency-free Web Component (WebGL2).
 * Inspired by github.com/254558/iphone-duo-fold-preview (MIT, jadon7): hinge fold with a
 * smooth Hermite crease, fixed front-view projection of the screen content, image-space
 * motion blur and darkening, and a cover display that fades in as the device closes.
 *
 * Attributes: src, angle (0 closed … 180 open), clock, controls, orbit, autoplay,
 *             fold-on-click, recenter, color, blur (default 72).
 * JS API:     el.angle = 90; await el.foldTo(0, 800); el.toggle(); el.source = canvas;
 *             'foldchange' event (detail.angle).
 */
(() => {
  if (customElements.get('duo-fold')) return;

  // ---- device dimensions (scene units) -------------------------------------------------
  const D = {
    A: 8.15, // half width of the open device
    B: 5.8, // half height
    R: 1.05, // corner radius
    T: 0.5, // thickness
    H: 0.03, // hinge axis offset in front of the inner face
    W: 0.38, // half width of the bending crease
    b: 0.2, // bezel
    c0: 0.5, // gap between hinge and the cover screen
    EYE: 40, // fixed front-view eye distance
  };

  // ---- tiny mat4 helpers (column-major) -------------------------------------------------
  const mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  };
  const perspective = (fovy, aspect, n, f) => {
    const t = 1 / Math.tan(fovy / 2);
    return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
  };
  const translate = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const rotY = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  };
  const rotX = (a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  // ---- geometry: a closed rounded slab, x-monotone, dense across the crease -------------
  function buildGeometry() {
    const { A, B, R, T, W } = D;
    const xs = [];
    const corner = 20, crease = 56;
    for (let i = 0; i <= corner; i++) {
      const th = Math.PI - ((i / corner) * Math.PI) / 2;
      xs.push(-(A - R) + R * Math.cos(th), A - R - R * Math.cos(th));
    }
    for (let i = 0; i <= crease; i++) xs.push(-W + (2 * W * i) / crease);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      xs.push(-(A - R) + t * (A - R - W), W + t * (A - R - W));
    }
    xs.sort((a, b) => a - b);
    const X = xs.filter((x, i) => i === 0 || x - xs[i - 1] > 1e-5);
    const top = (x) => {
      const dx = Math.abs(x) - (A - R);
      if (dx <= 0) return { y: B, nx: 0, ny: 1 };
      const yy = Math.sqrt(Math.max(0, R * R - dx * dx));
      return { y: B - R + yy, nx: (Math.sign(x) * dx) / R, ny: yy / R };
    };

    const pos = [], nrm = [], mat = [], idx = [];
    const v = (x, y, z, nx, ny, nz, m) => {
      pos.push(x, y, z);
      nrm.push(nx, ny, nz);
      mat.push(m);
      return pos.length / 3 - 1;
    };
    // front (inner display side, z = 0) and back (z = -T)
    for (const [z, nz, m] of [[0, 1, 0], [-T, -1, 1]]) {
      let prev = null;
      for (const x of X) {
        const y = top(x).y;
        const cur = [v(x, y, z, 0, 0, nz, m), v(x, -y, z, 0, 0, nz, m)];
        if (prev) idx.push(prev[0], prev[1], cur[0], prev[1], cur[1], cur[0]);
        prev = cur;
      }
    }
    // side walls along the outline
    const ring = [];
    for (const x of X) {
      const t = top(x);
      ring.push([x, t.y, t.nx, t.ny]);
    }
    for (let i = X.length - 1; i >= 0; i--) {
      const t = top(X[i]);
      ring.push([X[i], -t.y, t.nx, -t.ny]);
    }
    let first = null, prev = null;
    for (const [x, y, nx, ny] of ring) {
      const cur = [v(x, y, 0, nx, ny, 0, 2), v(x, y, -T, nx, ny, 0, 2)];
      if (prev) idx.push(prev[0], prev[1], cur[0], prev[1], cur[1], cur[0]);
      else first = cur;
      prev = cur;
    }
    idx.push(prev[0], prev[1], first[0], prev[1], first[1], first[0]);
    return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), mat: new Float32Array(mat), idx: new Uint16Array(idx) };
  }

  // ---- shaders --------------------------------------------------------------------------
  const VERT = `#version 300 es
  in vec3 aPos; in vec3 aNrm; in float aMat;
  uniform mat4 uModel, uViewProj;
  uniform float uFold, uHinge, uW;
  out vec3 vFold; out vec3 vWorld; out vec3 vN; out vec3 vFaceN; out vec3 vRest; flat out int vMat;
  vec2 rotH(vec2 p){ float c=cos(uFold), s=sin(uFold); p.y-=uHinge; return vec2(c*p.x+s*p.y, -s*p.x+c*p.y+uHinge); }
  void bend(float x, out vec2 P, out vec2 t){
    if (x >= uW) { P = vec2(x, 0.); t = vec2(1., 0.); return; }
    if (x <= -uW) { P = rotH(vec2(x, 0.)); t = vec2(cos(uFold), -sin(uFold)); return; }
    float s = (x + uW) / (2.*uW), s2 = s*s, s3 = s2*s;
    vec2 a = rotH(vec2(-uW, 0.)), b = vec2(uW, 0.);
    vec2 ta = 2.*uW*vec2(cos(uFold), -sin(uFold)), tb = vec2(2.*uW, 0.);
    P = (2.*s3-3.*s2+1.)*a + (s3-2.*s2+s)*ta + (-2.*s3+3.*s2)*b + (s3-s2)*tb;
    t = normalize((6.*s2-6.*s)*a + (3.*s2-4.*s+1.)*ta + (-6.*s2+6.*s)*b + (3.*s2-2.*s)*tb);
  }
  void main(){
    vec2 P, t; bend(aPos.x, P, t);
    vec2 N = vec2(-t.y, t.x);
    vec2 xz = P + aPos.z * N;
    vec3 p = vec3(xz.x, aPos.y, xz.y);
    vec2 nxz = aNrm.x * t + aNrm.z * N;
    vFold = p;
    vRest = aPos;
    vMat = int(aMat + .5);
    vN = mat3(uModel) * vec3(nxz.x, aNrm.y, nxz.y);
    vFaceN = mat3(uModel) * vec3(N.x, 0., N.y);
    vec4 w = uModel * vec4(p, 1.);
    vWorld = w.xyz;
    gl_Position = uViewProj * w;
  }`;

  const FRAG = `#version 300 es
  precision highp float;
  in vec3 vFold; in vec3 vWorld; in vec3 vN; in vec3 vFaceN; in vec3 vRest; flat in int vMat;
  out vec4 outColor;
  uniform sampler2D uInner, uOuter;
  uniform vec2 uInnerTexel, uOuterTexel;
  uniform vec4 uInnerFrame, uOuterFrame;
  uniform float uFold, uHinge, uEye, uBlur, uOuterOn;
  uniform vec3 uCam, uBody;
  uniform float uA, uB, uR, uT, uBez, uC0;

  vec2 rotH(vec2 p){ float c=cos(uFold), s=sin(uFold); p.y-=uHinge; return vec2(c*p.x+s*p.y, -s*p.x+c*p.y+uHinge); }
  float sdBox(vec2 p, vec2 h, float r){ vec2 q = abs(p) - h + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
  float fill(float d){ float a = max(fwidth(d), 1e-4); return 1. - smoothstep(-a, a, d); }

  vec3 env(vec3 r){
    float up = r.y * .5 + .5;
    vec3 c = mix(vec3(.07,.07,.08), vec3(.92,.92,.94), smoothstep(.3, .95, up));
    c += vec3(1.1) * exp(-pow((r.x + .55) * 4., 2.)) * smoothstep(.35, .9, up);
    c += vec3(.5) * exp(-pow((r.x - .75) * 5., 2.)) * smoothstep(.1, .6, up);
    return c;
  }

  // Fixed front-view projection + image-space blur and darkening (after the reference project).
  vec3 screen(sampler2D tex, vec2 texel, vec4 frame, bool inner){
    float depth = uEye / (uEye - vFold.z);
    vec2 proj = vFold.xy * depth;
    vec2 uv = (proj - frame.xy) / frame.zw;
    float progress, edge;
    if (inner) {
      progress = clamp(uFold / 1.5707963, 0., 1.);
      edge = (uv.x - .5) / -.5;
    } else {
      vec2 e = rotH(vec2(-uC0, -uT));
      float anchorX = e.x * uEye / (uEye - e.y);
      uv.x = (proj.x - anchorX) / frame.z;
      progress = clamp((3.14159265 - uFold) / 1.5707963, 0., 1.);
      edge = uv.x;
    }
    float motion = smoothstep(0., 1., progress);
    float darkG = clamp((edge - .2) / .8, 0., 1.);
    float effect = motion * pow(darkG, 1.35);
    float radius = uBlur * motion * pow(clamp(edge, 0., 1.), 1.35);
    vec2 aa = max(fwidth(uv), texel * .5);
    vec2 dx = dFdx(uv) / texel, dy = dFdy(uv) / texel;
    float baseLod = log2(max(1., max(length(dx), length(dy))));
    vec2 cov = smoothstep(-aa, aa, uv) * (1. - smoothstep(1. - aa, 1. + aa, uv));
    vec3 col = textureLod(tex, clamp(uv, 0., 1.), baseLod).rgb * cov.x * cov.y;
    if (radius > .5) {
      float lod = max(baseLod, log2(max(1., radius)));
      vec2 fp = max(aa, texel * radius * .75);
      col = vec3(0.);
      for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
        float wx = x == 0 ? 6. : (abs(x) == 1 ? 4. : 1.);
        float wy = y == 0 ? 6. : (abs(y) == 1 ? 4. : 1.);
        vec2 s = uv + vec2(float(x), float(y)) * texel * radius;
        vec2 c = smoothstep(-fp, fp, s) * (1. - smoothstep(1. - fp, 1. + fp, s));
        col += textureLod(tex, clamp(s, 0., 1.), lod).rgb * c.x * c.y * wx * wy / 256.;
      }
    }
    return col * (1. - min(1., effect * 2.));
  }

  void main(){
    vec3 V = normalize(uCam - vWorld);
    vec3 n = normalize(vN);
    vec3 L = normalize(vec3(-.45, .75, .9));
    vec3 L2 = normalize(vec3(.7, -.1, -.6));
    vec2 q = vRest.xy;
    vec3 col;

    if (vMat == 2) {
      // side wall with a soft rounded bevel towards both faces
      float u = (vRest.z / uT) * 2. + 1.;          // +1 front … -1 back
      n = normalize(n + normalize(vFaceN) * u * u * u * 1.6);
    }

    float diff = max(dot(n, L), 0.) * .7 + .38 + max(dot(n, L2), 0.) * .18;
    float spec = pow(max(dot(n, normalize(L + V)), 0.), 70.);
    float fres = .04 + .96 * pow(1. - max(dot(n, V), 0.), 5.);
    vec3 refl = env(reflect(-V, n));
    vec3 body = uBody * diff + spec * .45 + refl * mix(.10, .55, fres) * .55;
    vec3 glass = vec3(.012) + refl * mix(.035, .8, fres) * .55 + spec * .6;

    if (vMat == 2) {
      col = body;
    } else if (vMat == 0) {
      float m = fill(sdBox(q, vec2(uA - uBez, uB - uBez), uR - uBez));
      col = glass + screen(uInner, uInnerTexel, uInnerFrame, true) * m;
      float rim = fill(sdBox(q, vec2(uA - .045, uB - .045), uR - .045));
      col = mix(body, col, rim);
    } else {
      if (q.x < 0.) {
        float hw = (uA - uBez - uC0) * .5;
        float m = fill(sdBox(q - vec2(-uC0 - hw, 0.), vec2(hw, uB - uBez), uR - uBez));
        vec3 s = screen(uOuter, uOuterTexel, uOuterFrame, false) * uOuterOn;
        col = mix(body, glass + s, m);
      } else {
        col = body;
        // camera plateau with three lenses
        vec2 c = vec2(uA * .34, uB - 1.55);
        float plate = fill(sdBox(q - c, vec2(2.15, .95), .95));
        col = mix(col, col * .9 + refl * .08, plate);
        for (int i = -1; i <= 1; i++) {
          vec2 lc = c + vec2(float(i) * 1.3, 0.);
          float d = length(q - lc);
          col = mix(col, vec3(.16) + refl * .25, fill(d - .58));
          col = mix(col, vec3(.02) + refl * .35 + spec, fill(d - .42));
          col += vec3(.25, .3, .5) * fill(d - .16) * .4;
        }
        col = mix(col, vec3(.95, .9, .8), fill(length(q - c - vec2(2.25, .55)) - .14));
      }
      float rim = fill(sdBox(q, vec2(uA - .045, uB - .045), uR - .045));
      col = mix(body, col, rim);
    }
    outColor = vec4(col, 1.);
  }`;

  // ---- content painting ---------------------------------------------------------------
  const INNER_W = 1600;
  const innerSize = () => {
    const w = 2 * (D.A - D.b), h = 2 * (D.B - D.b);
    return [INNER_W, Math.round((INNER_W * h) / w)];
  };
  const outerW = () => Math.round((INNER_W * (D.A - D.b - D.c0)) / (2 * (D.A - D.b)));

  function defaultWallpaper(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#1d2b53');
    bg.addColorStop(0.55, '#7e4b8f');
    bg.addColorStop(1, '#f2a65a');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const blob = (x, y, r, col) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
    };
    blob(w * 0.2, h * 0.8, w * 0.45, 'rgba(255,120,150,.55)');
    blob(w * 0.85, h * 0.15, w * 0.4, 'rgba(90,200,255,.45)');
    blob(w * 0.6, h * 0.7, w * 0.3, 'rgba(255,220,120,.5)');
    g.globalAlpha = 0.12;
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.arc(w * 0.7, h * 1.1, 120 + i * 70, 0, Math.PI * 2);
      g.stroke();
    }
    return c;
  }

  function drawCover(g, src, w, h) {
    const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
    if (!sw || !sh) return false;
    const s = Math.max(w / sw, h / sh);
    g.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
    return true;
  }

  function drawClock(g, w, h, lang, scale) {
    const now = new Date();
    const time = now.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
    g.save();
    g.fillStyle = 'rgba(255,255,255,.96)';
    g.shadowColor = 'rgba(0,0,0,.25)';
    g.shadowBlur = 24 * scale;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const font = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
    g.font = `600 ${Math.round(46 * scale)}px ${font}`;
    g.fillText(date, w / 2, h * 0.2);
    g.font = `500 ${Math.round(250 * scale)}px ${font}`;
    g.fillText(time, w / 2, h * 0.2 + 255 * scale);
    g.restore();
  }

  // ---- the element ------------------------------------------------------------------------
  const GEO = buildGeometry();

  class DuoFold extends HTMLElement {
    static get observedAttributes() {
      return ['src', 'angle', 'clock', 'controls', 'autoplay', 'color', 'blur', 'orbit', 'recenter'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host{display:block;position:relative;width:100%;aspect-ratio:16/12;contain:content;-webkit-tap-highlight-color:transparent}
          .stage{position:absolute;inset:0;bottom:var(--duo-controls-h,0px)}
          canvas{width:100%;height:100%;display:block}
          :host([orbit]) canvas{cursor:grab;touch-action:pan-y}
          :host([orbit]) canvas:active{cursor:grabbing}
          :host([fold-on-click]) canvas{cursor:pointer}
          .controls{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:min(320px,80%);height:44px;display:none;align-items:center;gap:12px;font:500 13px/1 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;color:var(--duo-text,#666)}
          :host([controls]){--duo-controls-h:52px}
          :host([controls]) .controls{display:flex}
          input{flex:1;accent-color:var(--duo-accent,#0a84ff)}
          output{width:3.2em;text-align:right;font-variant-numeric:tabular-nums}
          .fallback{position:absolute;inset:0;display:none;place-items:center;font:14px sans-serif;color:#888}
        </style>
        <div class="stage"><canvas part="canvas"></canvas><div class="fallback">WebGL2 not available</div></div>
        <div class="controls" part="controls">
          <input type="range" min="0" max="180" step="0.5" aria-label="Fold angle"><output>180°</output>
        </div>`;
      this._canvas = root.querySelector('canvas');
      this._range = root.querySelector('input');
      this._out = root.querySelector('output');
      this._angle = 180;
      this._yaw = 0;
      this._pitch = 0;
      this._tYaw = 0;
      this._tPitch = 0;
      this._dirty = true;
      this._visible = true;
      this._source = null;
      this._lastMinute = -1;

      this._range.addEventListener('input', () => {
        this._stopAuto();
        this._cancelAnim();
        this._set(+this._range.value);
      });

      // orbit / click
      let drag = null;
      this._canvas.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY, yaw: this._tYaw, pitch: this._tPitch, moved: false, id: e.pointerId };
      });
      this._canvas.addEventListener('pointermove', (e) => {
        if (!drag || drag.id !== e.pointerId) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) {
          drag.moved = true;
          if (this.hasAttribute('orbit')) this._canvas.setPointerCapture(e.pointerId);
        }
        if (drag.moved && this.hasAttribute('orbit')) {
          this._tYaw = clamp(drag.yaw + dx * 0.008, -Math.PI, Math.PI);
          this._tPitch = clamp(drag.pitch + dy * 0.006, -0.9, 0.9);
          this._dirty = true;
        }
      });
      const end = () => {
        if (!drag) return;
        if (!drag.moved && this.hasAttribute('fold-on-click')) {
          this._stopAuto();
          this.toggle();
        }
        drag = null;
      };
      this._canvas.addEventListener('pointerup', end);
      this._canvas.addEventListener('pointercancel', () => {
        drag = null;
      });
      this._canvas.addEventListener('dblclick', () => {
        this._tYaw = 0;
        this._tPitch = 0;
        this._dirty = true;
      });
    }

    connectedCallback() {
      if (!this._gl && !this._init()) return;
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this._canvas);
      this._io = new IntersectionObserver(([e]) => {
        this._visible = e.isIntersecting;
        if (this._visible) this._dirty = true;
      });
      this._io.observe(this);
      if (!this._srcLoaded) this._loadSrc();
      if (this.hasAttribute('autoplay')) this._startAuto();
      const loop = (t) => {
        this._raf = requestAnimationFrame(loop);
        this._frame(t);
      };
      this._raf = requestAnimationFrame(loop);
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      this._ro?.disconnect();
      this._io?.disconnect();
      this._stopAuto();
    }

    attributeChangedCallback(name, old, val) {
      if (name === 'angle' && !this._settingAttr) this._set(parseFloat(val) || 0, true);
      else if (name === 'src' && this.isConnected) this._loadSrc();
      else if (name === 'autoplay' && this.isConnected) val === null ? this._stopAuto() : this._startAuto();
      else if (name === 'clock') this._paint();
      this._dirty = true;
    }

    // ---- public API ----
    get angle() {
      return this._angle;
    }
    set angle(v) {
      this._cancelAnim();
      this._set(+v);
    }
    get source() {
      return this._source;
    }
    set source(el) {
      this._source = el;
      this._srcLoaded = true;
      this._paint();
    }

    foldTo(target, duration = 700) {
      this._cancelAnim();
      const from = this._angle, to = clamp(+target, 0, 180);
      const dur = Math.max(1, (duration * Math.abs(to - from)) / 180);
      return new Promise((resolve) => {
        const t0 = performance.now();
        this._anim = { resolve };
        const step = (now) => {
          if (!this._anim) return resolve();
          const k = Math.min(1, (now - t0) / dur);
          this._set(from + (to - from) * ease(k));
          if (k < 1) this._anim.raf = requestAnimationFrame(step);
          else {
            this._anim = null;
            resolve();
          }
        };
        this._anim.raf = requestAnimationFrame(step);
      });
    }
    toggle(duration = 900) {
      return this.foldTo(this._angle > 90 ? 0 : 180, duration);
    }
    open(d) {
      return this.foldTo(180, d);
    }
    close(d) {
      return this.foldTo(0, d);
    }

    // ---- internals ----
    _cancelAnim() {
      if (this._anim) {
        cancelAnimationFrame(this._anim.raf);
        this._anim.resolve();
        this._anim = null;
      }
    }
    _set(a, fromAttr) {
      a = clamp(a, 0, 180);
      if (a === this._angle && !fromAttr) return;
      this._angle = a;
      this._range.value = a;
      this._out.textContent = `${Math.round(a)}°`;
      this._dirty = true;
      if (!fromAttr) {
        this._settingAttr = true;
        this.setAttribute('angle', a.toFixed(1).replace(/\.0$/, ''));
        this._settingAttr = false;
      }
      this.dispatchEvent(new CustomEvent('foldchange', { detail: { angle: a } }));
    }
    _startAuto() {
      this._stopAuto();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      let alive = true;
      this._auto = () => {
        alive = false;
      };
      const run = async () => {
        while (alive) {
          await new Promise((r) => setTimeout(r, 1100));
          if (!alive) return;
          await this.foldTo(this._angle > 90 ? 0 : 180, 2200);
        }
      };
      run();
    }
    _stopAuto() {
      if (this._auto) {
        this._auto();
        this._auto = null;
      }
    }

    _loadSrc() {
      const src = this.getAttribute('src');
      this._srcLoaded = true;
      if (!src) {
        if (!this._source) this._paint();
        return;
      }
      const isVideo = /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(src);
      const el = document.createElement(isVideo ? 'video' : 'img');
      el.crossOrigin = 'anonymous';
      if (isVideo) {
        Object.assign(el, { muted: true, loop: true, playsInline: true, autoplay: true });
        el.addEventListener('loadeddata', () => {
          this._source = el;
          this._paint();
          el.play().catch(() => {});
        }, { once: true });
      } else {
        el.addEventListener('load', () => {
          this._source = el;
          this._paint();
        }, { once: true });
      }
      el.addEventListener('error', () => console.warn('[duo-fold] could not load', src));
      el.src = src;
    }

    _paint() {
      if (!this._gl) return;
      const [w, h] = innerSize(), ow = outerW();
      const wp = (this._wp ||= document.createElement('canvas'));
      wp.width = w;
      wp.height = h;
      const g = wp.getContext('2d');
      if (!(this._source && drawCover(g, this._source, w, h))) g.drawImage((this._defaultWp ||= defaultWallpaper(w, h)), 0, 0);

      const lang = this.closest('[lang]')?.lang || navigator.language;
      const clock = this.hasAttribute('clock');
      const inner = (this._innerCv ||= document.createElement('canvas'));
      inner.width = w;
      inner.height = h;
      const gi = inner.getContext('2d');
      gi.drawImage(wp, 0, 0);
      if (clock) drawClock(gi, w, h, lang, 1);
      const outer = (this._outerCv ||= document.createElement('canvas'));
      outer.width = ow;
      outer.height = h;
      const go = outer.getContext('2d');
      go.drawImage(wp, w - ow, 0, ow, h, 0, 0, ow, h);
      if (clock) drawClock(go, ow, h, lang, 0.78);
      this._upload(this._texInner, inner);
      this._upload(this._texOuter, outer);
      this._lastMinute = new Date().getMinutes();
      this._dirty = true;
    }

    _upload(tex, canvas) {
      const gl = this._gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      tex.size = [canvas.width, canvas.height];
    }

    _init() {
      const gl = this._canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
      if (!gl) {
        this.shadowRoot.querySelector('.fallback').style.display = 'grid';
        return false;
      }
      this._gl = gl;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this._prog = p;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const attr = (name, data, size) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(p, name);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      };
      attr('aPos', GEO.pos, 3);
      attr('aNrm', GEO.nrm, 3);
      attr('aMat', GEO.mat, 1);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, GEO.idx, gl.STATIC_DRAW);
      this._vao = vao;
      const tex = () => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };
      this._texInner = tex();
      this._texOuter = tex();
      this._u = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(p, i).name;
        this._u[name] = gl.getUniformLocation(p, name);
      }
      gl.enable(gl.DEPTH_TEST);
      this._canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
      this._paint();
      return true;
    }

    _resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const r = this._canvas.getBoundingClientRect();
      this._canvas.width = Math.max(1, Math.round(r.width * dpr));
      this._canvas.height = Math.max(1, Math.round(r.height * dpr));
      this._dirty = true;
    }

    _frame() {
      const gl = this._gl;
      if (!gl || !this._visible) return;
      // live sources
      const src = this._source;
      if (src instanceof HTMLVideoElement && !src.paused) this._paint();
      else if (src instanceof HTMLCanvasElement && this.hasAttribute('live')) this._paint();
      else if (this.hasAttribute('clock') && new Date().getMinutes() !== this._lastMinute) this._paint();
      // orbit damping
      const ky = this._tYaw - this._yaw, kp = this._tPitch - this._pitch;
      if (Math.abs(ky) + Math.abs(kp) > 1e-4) {
        this._yaw += ky * 0.15;
        this._pitch += kp * 0.15;
        this._dirty = true;
      }
      if (!this._dirty) return;
      this._dirty = false;

      const W = this._canvas.width, H = this._canvas.height;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this._prog);
      gl.bindVertexArray(this._vao);

      const fold = ((180 - this._angle) / 180) * Math.PI;
      const recenter = this.hasAttribute('recenter') ? -(D.A / 2) * (1 - this._angle / 180) : 0;
      const ppu = Math.min(W / (2 * D.A + 2), H / (2 * D.B + 4.2));
      const fov = 2 * Math.atan(H / ppu / 2 / D.EYE);
      const proj = perspective(fov, W / H, 0.1, 200);
      const view = translate(0, 0, -D.EYE);
      const model = mul(translate(recenter, 0, 0), mul(rotX(this._pitch), rotY(this._yaw)));
      const u = this._u;
      gl.uniformMatrix4fv(u.uModel, false, model);
      gl.uniformMatrix4fv(u.uViewProj, false, mul(proj, view));
      gl.uniform1f(u.uFold, fold);
      gl.uniform1f(u.uHinge, D.H);
      gl.uniform1f(u.uW, D.W);
      gl.uniform1f(u.uEye, D.EYE);
      gl.uniform3f(u.uCam, 0, 0, D.EYE);
      gl.uniform1f(u.uA, D.A);
      gl.uniform1f(u.uB, D.B);
      gl.uniform1f(u.uR, D.R);
      gl.uniform1f(u.uT, D.T);
      gl.uniform1f(u.uBez, D.b);
      gl.uniform1f(u.uC0, D.c0);
      gl.uniform1f(u.uBlur, parseFloat(this.getAttribute('blur') ?? 72));
      gl.uniform1f(u.uOuterOn, this._angle >= 180 ? 0 : 1);
      const hex = (this.getAttribute('color') || '#d9d6cf').replace('#', '');
      const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      gl.uniform3f(u.uBody, ...[0, 2, 4].map((i) => (parseInt(full.slice(i, i + 2), 16) / 255) * 0.8));

      const iw = D.A - D.b, ih = D.B - D.b;
      gl.uniform4f(u.uInnerFrame, -iw, -ih, 2 * iw, 2 * ih);
      const zc = 2 * D.H + D.T, k = D.EYE / (D.EYE - zc);
      gl.uniform4f(u.uOuterFrame, D.c0 * k, -ih * k, (iw - D.c0) * k, 2 * ih * k);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._texInner);
      gl.uniform1i(u.uInner, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this._texOuter);
      gl.uniform1i(u.uOuter, 1);
      const ts = this._texInner.size, to = this._texOuter.size;
      gl.uniform2f(u.uInnerTexel, 1 / ts[0], 1 / ts[1]);
      gl.uniform2f(u.uOuterTexel, 1 / to[0], 1 / to[1]);
      gl.drawElements(gl.TRIANGLES, GEO.idx.length, gl.UNSIGNED_SHORT, 0);
    }
  }

  customElements.define('duo-fold', DuoFold);
})();

export {};
