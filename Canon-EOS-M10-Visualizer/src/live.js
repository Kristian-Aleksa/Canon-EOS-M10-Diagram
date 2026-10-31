// Live behaviour. Runs after the kit (iso, pathOf, translateAlong, lineOnTop) and the config block.
const stage = document.querySelector(".cam-stage");
const svg = stage.querySelector("svg");
const part = (name) => svg.querySelector(`[data-part="${name}"]`);
const readout = document.querySelector("[data-readout]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const SPEED = () => window.__driveSpeed || 1;

const el = {
  subject: part("subject"), focus: part("focus-group"), blades: part("blades"), curtains: part("curtains"), rays: part("rays"),
  lcdKing: part("lcd-king"), lcdDark: part("lcd-dark"), lcdBright: part("lcd-bright"), lcdBlack: part("lcd-black"), lcdText: part("lcd-text"), lcdAf: part("lcd-af"), lcdSigma: part("lcd-sigma"),
  exposed: part("exposed"),
  digic: part("digic")?.firstElementChild, pulse: part("flex-pulse"), led: part("lamp-led"), dialMark: part("dial-mark"), button: part("button"),
};
const F = CAMERA.focal;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const fall = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t); // a curtain accelerates as its spring pulls it
const svgNS = "http://www.w3.org/2000/svg";
const P3 = (x, y, z) => iso([x, y, z], P);
const path = (pts, closed) => pathOf(pts.map(([x, y, z]) => P3(x, y, z)), closed);
const kingR = (h) => {
  for (let i = 0; i < KING.length - 1; i++) {
    const [s0, r0] = KING[i];
    const [s1, r1] = KING[i + 1];
    if (h >= s0 && h <= s1) return s1 === s0 ? Math.max(r0, r1) : lerp(r0, r1, (h - s0) / (s1 - s0));
  }
  return 1.1;
};
const stopRadius = (N) => (1.6 * F) / (2 * N);
const blurOf = (s, focus, N) => {
  const vs = imageDistance(s, F);
  const vf = imageDistance(focus, F);
  return ((F / N) * Math.abs(vs - vf)) / vs;
};
const travelOf = (focus) => 0.4 * (imageDistance(focus, F) - F); // focus group shift, scaled to the drawing

// ---------------------------------------------------------------- state
const state = {
  s: S_REST, sTarget: S_REST,
  focus: 2000, focusTarget: 2000, focusRate: 0, // lens set to about 2 m at switch-on
  N: 8, t: 1 / 125,
  open: CAMERA.apertures[0], // the blades stay wide open for live view and AF
  front: 1, rear: 0, // curtain progress: front 1 = parked below (open), rear 0 = parked above (open)
  shot: null, // the running sequence
  review: 0, captured: null, frames: 0,
  half: false, sharp: false, phase: "live view",
  pulse: 0, digic: 0, led: 0, black: 0, press: 0,
};

// ---------------------------------------------------------------- drawing
function bladesSvg(N) {
  const r = stopRadius(N);
  const R = 13;
  const s = STOP_S + 0.2;
  const to3 = ([U, W]) => [s, -W, AXZ + U]; // local U up, W toward the far side
  const n = CAMERA.blades;
  const rot = 0.21;
  const Rv = r / Math.cos(Math.PI / n);
  const verts = Array.from({ length: n }, (_, k) => [Math.cos(rot + (k * 2 * Math.PI) / n) * Rv, Math.sin(rot + (k * 2 * Math.PI) / n) * Rv]);
  // the heptagon clipped to the far half W >= 0
  const clipped = [];
  for (let k = 0; k < n; k++) {
    const a = verts[k];
    const b = verts[(k + 1) % n];
    if (a[1] >= 0) clipped.push(a);
    if ((a[1] >= 0) !== (b[1] >= 0)) {
      const t = a[1] / (a[1] - b[1]);
      clipped.push([lerp(a[0], b[0], t), 0]);
    }
  }
  const disc = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI;
    disc.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  const fill = path(disc.map(to3), true) + path(clipped.map(to3), true);
  const edges = [];
  for (let k = 0; k < n; k++) {
    const v = verts[k];
    const prev = verts[(k + n - 1) % n];
    const dir = [v[0] - prev[0], v[1] - prev[1]];
    const len = Math.hypot(dir[0], dir[1]);
    const d = [dir[0] / len, dir[1] / len];
    // extend from the vertex until radius R
    const b = 2 * (v[0] * d[0] + v[1] * d[1]);
    const c = v[0] * v[0] + v[1] * v[1] - R * R;
    const t = (-b + Math.sqrt(b * b - 4 * c)) / 2;
    let p = v;
    let q = [v[0] + d[0] * t, v[1] + d[1] * t];
    if (p[1] < 0 && q[1] < 0) continue;
    if (p[1] < 0) p = [lerp(p[0], q[0], p[1] / (p[1] - q[1])), 0];
    if (q[1] < 0) q = [lerp(p[0], q[0], p[1] / (p[1] - q[1])), 0];
    edges.push(path([p, q].map(to3)));
  }
  const cut = (sign) => {
    const inner = clipped.filter(([, w]) => Math.abs(w) < 1e-6).map(([u]) => u).filter((u) => Math.sign(u) === sign);
    const u0 = inner.length ? inner[0] : sign * r;
    return path([[STOP_S - 0.5, 0, AXZ + u0], [s, 0, AXZ + u0], [s, 0, AXZ + sign * R], [STOP_S - 0.5, 0, AXZ + sign * R]], true);
  };
  return `<path class="cam-blade" fill-rule="evenodd" d="${fill}"/><path class="cam-blade-edge" d="${edges.join("")}"/><path class="cam-blade" d="${cut(1)}${cut(-1)}"/>`;
}

const BLADES = 4;
function curtainsSvg(front, rear) {
  const top = AXZ + GATE.z;
  const bottom = AXZ - GATE.z;
  const faces = [];
  const cuts = [];
  const blade = (x, z0, z1) => {
    faces.push(`<path class="cam-blade" d="${path([[x, -13.6, z0], [x, 0, z0], [x, 0, z1], [x, -13.6, z1]], true)}"/>`);
    cuts.push(path([[x - 0.25, 0, z0], [x + 0.25, 0, z0], [x + 0.25, 0, z1], [x - 0.25, 0, z1]], true));
  };
  // rear curtain (nearer the sensor): parked above the gate, closes downward
  for (let i = BLADES - 1; i >= 0; i--) {
    const z0 = lerp(top + 0.2 + i * 0.7, bottom + i * 4.3, rear);
    blade(SHUTTER.x0 + 1.8 + i * 0.1, z0, z0 + 5);
  }
  // front curtain: closed across the gate, falls to park below it
  for (let i = BLADES - 1; i >= 0; i--) {
    const z1 = lerp(top - i * 4.3, bottom - 0.2 - i * 0.7, front);
    blade(SHUTTER.x0 + 3.2 - i * 0.1, z1 - 5, z1);
  }
  return faces.join("") + `<path class="cam-blade-cut" d="${cuts.join("")}"/>`;
}

// The gate is covered where the front curtain (below its edge) or the rear curtain (above its edge) is.
const frontEdge = () => lerp(AXZ + GATE.z, AXZ - GATE.z - 0.2, state.front);
const rearEdge = () => lerp(AXZ + GATE.z + 0.2, AXZ - GATE.z, state.rear);
const openAt = (z) => z <= rearEdge() && z >= frontEdge() && Math.abs(z - AXZ) <= GATE.z;

function raysSvg() {
  const f = F;
  const vf = imageDistance(state.focus, f); // where the lens is set: its principal plane sits vf in front of the sensor
  const r = stopRadius(state.open);
  const out = [];
  const lines = [];
  const xFace = SHUTTER.x0 + 3.2;
  for (const h of [43.4, 4]) {
    const zS = KING_Z + h;
    const xS = state.s - kingR(h);
    const u = xS - vf;
    const v = 1 / (1 / f - 1 / u);
    const ix = vf - v;
    const iz = AXZ - ((zS - AXZ) * v) / u;
    const hits = [];
    for (const k of [1, 0, -1]) {
      const pz = AXZ + k * r;
      const dx = ix - STOP_S;
      const slope = (iz - pz) / dx;
      const zAt = (x) => pz + slope * (x - STOP_S);
      let end = [0, 0, zAt(0)];
      const zf = zAt(SHUTTER.x1);
      if (Math.abs(zf - AXZ) > GATE.z) end = [SHUTTER.x1, 0, zf];
      else if (!openAt(zAt(xFace))) end = [xFace, 0, zAt(xFace)];
      hits.push([STOP_S, 0, pz], end);
      lines.push(path([[xS, 0, zS], [STOP_S, 0, pz], end]));
    }
    out.push(`<path class="cam-sheet" d="${path([[xS, 0, zS], hits[0], hits[4]], true)}${path([hits[0], hits[1], hits[5], hits[4]], true)}"/>`);
  }
  return out.join("") + `<path class="iso-line cam-ray" data-tone="lit" d="${lines.join("")}"/>`;
}

// the picture: the king at true magnification, blurred by the true blur circle, exposed by auto ISO
const MM = SCREEN.w / CAMERA.sensor.w; // screen units per mm on the sensor
function picture(s, focus, N, t) {
  const u = s - imageDistance(s, F);
  const m = imageDistance(s, F) / u;
  const exp = exposureOf(N, t, CAMERA.sceneEV);
  return { m, blur: blurOf(s, focus, N), exp, s, N, t };
}
function showPicture(pic, text) {
  const k = pic.m * MM;
  const yBase = SCREEN.h / 2 + (AXZ - KING_Z) * k;
  el.lcdKing.setAttribute("transform", `translate(${(SCREEN.w / 2).toFixed(2)} ${yBase.toFixed(2)}) scale(${k.toFixed(4)})`);
  el.lcdSigma.setAttribute("stdDeviation", ((pic.blur * MM) / 2.4).toFixed(2));
  const e = pic.exp.error;
  el.lcdDark.setAttribute("opacity", e < 0 ? (1 - 2 ** e).toFixed(3) : "0");
  el.lcdBright.setAttribute("opacity", e > 0 ? Math.min(0.85, 1 - 2 ** -e).toFixed(3) : "0");
  el.lcdText.textContent = text;
  if (pic.blur * MM < 0.35) el.lcdAf.setAttribute("data-sharp", "");
  else el.lcdAf.removeAttribute("data-sharp");
}
// light on the die: the band of the gate the curtains leave open
function showExposed() {
  const lo = Math.max(frontEdge(), AXZ - CAMERA.sensor.h / 2);
  const hi = Math.min(rearEdge(), AXZ + CAMERA.sensor.h / 2);
  const w = CAMERA.sensor.w / 2;
  el.exposed.setAttribute("d", hi > lo ? path([[-0.6, 0, lo], [-0.6, -w, lo], [-0.6, -w, hi], [-0.6, 0, hi]], true) : "");
  el.exposed.style.opacity = state.shot && state.shot.clock >= state.shot.steps.front[0] && state.shot.clock <= state.shot.steps.rear[1] ? "1" : ".45";
}

const label = (t) => (t >= 1 ? `${t}"` : `1/${Math.round(1 / t)}`);
const fText = (N) => `F${N}`;
function draw() {
  el.subject.setAttribute("transform", translateAlong(P, [state.s, 0, 0]));
  el.focus.setAttribute("transform", translateAlong(P, [travelOf(state.focus), 0, 0]));
  el.blades.innerHTML = bladesSvg(state.open);
  el.curtains.innerHTML = curtainsSvg(state.front, state.rear);
  el.rays.innerHTML = raysSvg();
  const live = picture(state.s, state.focus, state.N, state.t);
  showExposed();
  if (state.review > 0 && state.captured) showPicture(state.captured, state.captured.text);
  else showPicture(live, `${label(state.t)}  ${fText(state.N)}  ISO ${live.exp.iso}`);
  el.lcdBlack.setAttribute("opacity", state.black.toFixed(3));
  el.pulse.style.opacity = state.pulse > 0 ? "1" : "0";
  el.pulse.style.strokeDashoffset = (-state.pulse * 40).toFixed(2);
  if (el.digic) state.digic > 0 ? el.digic.setAttribute("data-lit", "") : el.digic.removeAttribute("data-lit");
  if (el.led) el.led.style.opacity = state.led.toFixed(2);
  el.button.setAttribute("transform", translateAlong(P, [0, 0, -state.press]));
  const index = CAMERA.speeds.indexOf(state.t);
  const a = -2.2 + (index / (CAMERA.speeds.length - 1)) * 4.4;
  el.dialMark.setAttribute("d", lineOnTop([6 + Math.sin(a) * 4.4, -46 - Math.cos(a) * 4.4], [6 + Math.sin(a) * 6.4, -46 - Math.cos(a) * 6.4], 106.6 + 3.8, P));
  const exp = live.exp;
  const text = `${(state.s / 1000).toFixed(2)} m · f/${state.N} · ${label(state.t).replace('"', " s")}${state.t < 1 ? " s" : ""} · ISO ${exp.iso} · ${state.phase}`;
  if (readout.textContent !== text) readout.textContent = text;
}

// ---------------------------------------------------------------- the sequence
// Every step is placed on one clock (ms of page time). Shutter steps run 100x slower than life.
const TRAVEL = CAMERA.travel * CAMERA.slow;
function plan() {
  const afMs = Math.abs(travelOf(state.s) - travelOf(state.focus)) > 0.02 ? 420 : 0;
  const steps = {};
  steps.af = [0, afMs];
  steps.stop = [afMs, afMs + 180];
  steps.close = [afMs + 60, afMs + 60 + TRAVEL];
  const open0 = steps.close[1] + 140;
  steps.front = [open0, open0 + TRAVEL];
  const rear0 = open0 + state.t * 1000 * CAMERA.slow;
  steps.rear = [rear0, rear0 + TRAVEL];
  const done = steps.rear[1];
  steps.read = [done + 80, done + 680];
  steps.digic = [done + 300, done + 1100];
  steps.card = [done + 900, done + 1500];
  steps.reset = [done + 160, done + 160 + TRAVEL];
  steps.reopen = [done + 60, done + 240];
  steps.end = done + 1600;
  return steps;
}

function shoot() {
  if (state.shot) return;
  state.shot = { clock: 0, steps: plan(), N: state.N, t: state.t, captured: false };
  state.half = true;
  kick();
}
function halfPress() {
  if (state.shot) return;
  state.half = true;
  state.focusTarget = state.s;
  state.phase = "focusing";
  kick();
}

function runShot(dt) {
  const shot = state.shot;
  shot.clock += dt * 1000;
  const c = shot.clock;
  const s = shot.steps;
  const span = ([a, b]) => clamp((c - a) / Math.max(1, b - a), 0, 1);
  state.focusTarget = state.s;
  state.press = c < s.rear[1] ? 1.1 : lerp(1.1, 0, span([s.rear[1], s.rear[1] + 300]));
  state.open = c < s.reopen[0] ? lerp(CAMERA.apertures[0], shot.N, ease(span(s.stop))) : lerp(shot.N, CAMERA.apertures[0], ease(span(s.reopen)));
  // front curtain: up to close the gate, then down to open it
  if (c < s.front[0]) state.front = 1 - ease(span(s.close));
  else state.front = fall(span(s.front));
  // rear curtain: down to end the exposure, then back up for live view
  if (c < s.reset[0]) state.rear = fall(span(s.rear));
  else state.rear = 1 - ease(span(s.reset));
  state.black = c < s.close[0] ? span([s.close[0] - 60, s.close[0]]) : c < s.reset[1] ? 1 : 1 - span([s.reset[1], s.reset[1] + 160]);
  state.pulse = c >= s.read[0] && c <= s.read[1] ? span(s.read) + 0.001 : 0;
  state.digic = c >= s.digic[0] && c <= s.digic[1] ? 1 : 0;
  state.led = c >= s.card[0] && c <= s.card[1] ? 0.5 + 0.5 * Math.sin((c - s.card[0]) / 40) : 0;
  if (!shot.captured && c >= s.rear[1]) {
    shot.captured = true;
    state.frames += 1;
    const pic = picture(state.s, state.focus, shot.N, shot.t);
    pic.text = `${label(shot.t)}  ${fText(shot.N)}  ISO ${pic.exp.iso}`;
    state.captured = pic;
  }
  if (c < s.af[1]) state.phase = "focusing";
  else if (c < s.front[0]) state.phase = "shutter closing";
  else if (c < s.rear[1]) state.phase = `exposing ${label(shot.t)} s, shown ${CAMERA.slow}× slower`;
  else if (c < s.digic[1]) state.phase = "reading 18 MP to DIGIC 6";
  else if (c < s.card[1]) state.phase = "writing to the card";
  else state.phase = `saved IMG_${String(state.frames).padStart(4, "0")}.JPG`;
  if (c >= s.reset[1] && state.review === 0 && shot.captured) state.review = 2.8;
  if (c >= s.end) {
    state.shot = null;
    state.half = false;
    state.press = 0;
    state.pulse = 0;
    state.digic = 0;
    state.led = 0;
  }
}

function settleNow() {
  // reduced motion: jump straight to the end of whatever was asked
  state.s = state.sTarget;
  state.focus = state.focusTarget;
  state.focusRate = 0;
  if (state.shot) {
    const shot = state.shot;
    state.focus = state.s;
    const pic = picture(state.s, state.focus, shot.N, shot.t);
    state.frames += 1;
    pic.text = `${label(shot.t)}  ${fText(shot.N)}  ISO ${pic.exp.iso}`;
    state.captured = pic;
    state.review = 2.8;
    state.shot = null;
    state.phase = `saved IMG_${String(state.frames).padStart(4, "0")}.JPG`;
  }
  state.front = 1;
  state.rear = 0;
  state.open = CAMERA.apertures[0];
  state.black = 0;
  state.press = 0;
}

// ---------------------------------------------------------------- loop
let frame = 0;
let last = 0;
let visible = false;
let touring = !still.matches;
let tourClock = 0;
let tourStep = -1;
let idleTimer = 0;
const TOUR = [
  { s: 262, N: 8, t: 1 / 125 },
  { s: 320, N: 6.3, t: 1 / 4000 },
  { s: 285, N: 16, t: 1 / 30 },
  { s: 255, N: 22, t: 1 / 1000 },
];
function tour(dt) {
  tourClock += dt;
  const step = TOUR[Math.max(0, tourStep) % TOUR.length];
  if (tourStep < 0 || (tourClock > 3 && !state.shot && state.review <= 0)) {
    tourStep += 1;
    tourClock = 0;
    const next = TOUR[tourStep % TOUR.length];
    state.sTarget = next.s;
    setSettings(next.N, next.t);
    state.phase = "live view";
    return;
  }
  if (tourClock > 1.4 && tourClock - dt <= 1.4) halfPress();
  if (tourClock > 2.1 && tourClock - dt <= 2.1) shoot();
  if (state.shot || state.review > 0) tourClock = Math.min(tourClock, 2.2);
  void step;
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) * SPEED() : 1 / 60;
  last = now;
  if (still.matches) settleNow();
  else {
    if (touring) tour(dt);
    state.s += (state.sTarget - state.s) * (1 - Math.exp(-dt / 0.25));
    if (Math.abs(state.sTarget - state.s) < 0.05) state.s = state.sTarget;
    if (state.half || state.shot) state.focusTarget = state.s;
    // the stepping motor drives the focus group with a stiff, damped spring
    const want = travelOf(state.focusTarget);
    const here = travelOf(state.focus);
    if (Math.abs(want - here) > 1e-4 || Math.abs(state.focusRate) > 1e-4) {
      for (let i = 0; i < 4; i++) {
        state.focusRate += ((state.focusTarget - state.focus) * 900 - state.focusRate * 60) * (dt / 4);
        state.focus += state.focusRate * (dt / 4);
      }
      if (Math.abs(state.focusTarget - state.focus) < 0.2 && Math.abs(state.focusRate) < 1) {
        state.focus = state.focusTarget;
        state.focusRate = 0;
      }
    }
    if (state.shot) runShot(dt);
    else if (state.half && state.focus === state.focusTarget) {
      state.half = false;
      state.phase = "in focus";
    }
    if (state.review > 0) state.review = Math.max(0, state.review - dt);
  }
  draw();
  const busy = touring || state.shot || state.half || state.review > 0 || state.s !== state.sTarget || state.focus !== state.focusTarget;
  frame = visible && busy && !still.matches ? requestAnimationFrame(tick) : 0;
}
function kick() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}
function quiet() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    touring = !still.matches;
    tourClock = 0;
    kick();
  }, 6000);
}

// ---------------------------------------------------------------- input
const buttons = document.querySelectorAll(".cam-controls button");
function setSettings(N, t) {
  if (N !== undefined) state.N = N;
  if (t !== undefined) state.t = t;
  buttons.forEach((b) => {
    if (b.dataset.aperture) b.setAttribute("aria-pressed", String(Number(b.dataset.aperture) === state.N));
    if (b.dataset.speed) b.setAttribute("aria-pressed", String(Math.abs(Number(b.dataset.speed) - state.t) < 1e-9));
  });
  kick();
}
buttons.forEach((b) =>
  b.addEventListener("click", () => {
    quiet();
    if (b.dataset.aperture) setSettings(Number(b.dataset.aperture));
    if (b.dataset.speed) setSettings(undefined, Number(b.dataset.speed));
    if (!state.shot) state.phase = "live view";
    draw();
  }),
);

const railScreen = (s) => iso([s, 0, KING_Z], P)[0];
function pointerToS(event) {
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const x = ((event.clientX - box.left) / box.width) * vb.width;
  const a = railScreen(S_RANGE[0]);
  const b = railScreen(S_RANGE[1]);
  return clamp(S_RANGE[0] + ((x - a) / (b - a)) * (S_RANGE[1] - S_RANGE[0]), S_RANGE[0], S_RANGE[1]);
}
stage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const x = ((event.clientX - box.left) / box.width) * vb.width;
  quiet();
  if (x > railScreen(S_RANGE[0]) - 40) {
    state.sTarget = Math.round(pointerToS(event));
    if (!state.shot) state.phase = "live view";
  }
  kick();
});
stage.addEventListener("click", () => {
  quiet();
  shoot();
});
stage.addEventListener("keydown", (event) => {
  let handled = true;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") state.sTarget = clamp(state.sTarget + 10, ...S_RANGE);
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") state.sTarget = clamp(state.sTarget - 10, ...S_RANGE);
  else if (event.key === " " || event.key === "Enter") shoot();
  else if (event.key === "f" || event.key === "F") halfPress();
  else if (event.key === "a" || event.key === "A") {
    const list = CAMERA.apertures;
    setSettings(list[(list.indexOf(state.N) + 1) % list.length]);
  } else if (event.key === "s" || event.key === "S") {
    const list = CAMERA.speeds;
    setSettings(undefined, list[(list.indexOf(state.t) + 1) % list.length]);
  } else handled = false;
  if (!handled) return;
  event.preventDefault();
  quiet();
  if (!state.shot && event.key.startsWith("Arrow")) state.phase = "live view";
  kick();
});
new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) kick();
  },
  { rootMargin: "120px 0px" },
).observe(stage);
still.addEventListener?.("change", () => {
  touring = !still.matches;
  kick();
});

if (still.matches) touring = false;
setSettings(state.N, state.t);
draw();
kick();
