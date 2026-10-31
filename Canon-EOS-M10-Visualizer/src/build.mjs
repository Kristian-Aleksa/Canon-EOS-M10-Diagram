import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../vendor/anatomy-kit/iso-kit.mjs";
import * as G from "../vendor/anatomy-kit/lathe.mjs";
import { halfTurn, turnSvg, sectionSvg, elementProfile, faceSvg, planeMatrix, at as turnAt } from "./cut.mjs";
import { CAMERA, imageDistance, exposureOf, speedLabel, fLabel } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const artifactAt = process.argv.includes("--artifact") ? process.argv[process.argv.indexOf("--artifact") + 1] : null;
// the kit's own source, inlined so the page can project points while it animates
const kitScript = () => readFileSync(join(ROOT, "vendor/anatomy-kit/iso-kit.mjs"), "utf8").replace(/^export /gm, "");
// follow the viewer: an explicit data-theme on <html>, else the system setting, else ?theme=light|dark
const THEME = `(()=>{const r=document.documentElement,b=document.body,m=matchMedia("(prefers-color-scheme: dark)"),q=new URLSearchParams(location.search).get("theme");const set=()=>{const t=r.dataset.theme||q||(m.matches?"dark":"light");b.classList.add("iso");b.dataset.theme=t;b.style.colorScheme=t};set();m.addEventListener("change",set);new MutationObserver(set).observe(r,{attributes:true,attributeFilter:["data-theme"]})})();`;

const WIDTH = 760;
const HEIGHT = 560;

// World: millimetres. x runs along the optical axis toward the subject, y is the camera's left
// (the near side, cut away), z is up. The sensor plane is x = 0.
const AXZ = 74; // optical axis height
const BODY = { x0: -16, x1: 15.5, y0: -62, z0: 40, z1: 106.6 };
const WALL = 1.8;
const IN = { x0: BODY.x0 + WALL, x1: BODY.x1 - WALL, y0: BODY.y0 + WALL, z0: BODY.z0 + WALL, z1: BODY.z1 - WALL };
const PLATE = { x: -46, y: -88, w: 420, d: 132, r: 8 };
const PLATE_H = 10;
const FOOT_H = 6;
const RAIL = { x0: -34, x1: 362 };
const RIDER_TOP = 16;
const S_RANGE = [250, 330]; // subject distance from the sensor plane, mm
const S_REST = 290;
const KING_Z = 50;
const LAMP = { x: 150, y: -66 };
const LCD = { x0: -20.5, x1: -14.5, y0: -45, y1: 30, z0: 109.5, z1: 161.5 };
const SCREEN = { w: 63.4, h: 42.3 };
const TILT = (150 * Math.PI) / 180;
const PANEL = (() => {
  const h = [BODY.x0 - 1.4, 0, BODY.z1 + 0.6];
  const d = [-Math.sin(TILT), 0, -Math.cos(TILT)];
  const n = [-Math.cos(TILT), 0, Math.sin(TILT)];
  const gap = 3;
  const c = G.add3(G.add3(h, G.mul3(d, gap + (LCD.z1 - LCD.z0) / 2)), [0, (LCD.y0 + LCD.y1) / 2, 0]);
  return { h, d, n, c, gap };
})();
const panelCorners = [-1, 1].flatMap((sy) => [-1, 1].map((sd) => G.add3(PANEL.c, G.add3([0, (sy * (LCD.y1 - LCD.y0)) / 2, 0], G.mul3(PANEL.d, (sd * (LCD.z1 - LCD.z0)) / 2)))));
const STOP_S = 56; // aperture blades plane
const GATE = { y: 12, z: 8.2 }; // shutter gate half sizes around the axis
const SHUTTER = { x0: 4, x1: 9 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), ...panelCorners, [S_RANGE[1], 0, KING_Z + 48], [LAMP.x, LAMP.y, 150]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 68 },
);
const KS = G.scaleOf(P);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const depth = (p) => k.depthOf(p, P);
const byDepth = (points) => [...points].sort((a, b) => depth([a[0], a[1], 0]) - depth([b[0], b[1], 0]));
const pathOf = (pts, closed) => k.pathOf(pts.map(at), closed);
const box = (x0, x1, y0, y1, z0, z1, steps = 2, r = 0.4) => k.slabOf({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r }, z0, z1 - z0, P, steps);
const AXIS = G.frameOf([0, 0, AXZ], [1, 0, 0], [0, 0, 1], [0, -1, 0]); // angle 0 up, angle pi/2 toward the far side
const alongX = (y, z) => G.frameOf([0, y, z], [1, 0, 0], [0, 0, 1], [0, -1, 0]);
const alongY = (x, z) => G.frameOf([x, 0, z], [0, 1, 0], [0, 0, 1], [1, 0, 0]);

// ---------------------------------------------------------------- bench
function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 8, -PLATE_H - FOOT_H, 1.8, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 6, -PLATE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(PLATE, -PLATE_H + 3, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
  // ruler: zero at the sensor plane
  const strip = { x: -6, y: 24, w: 352, d: 9, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.7, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(0, 340, 10, 5, strip.y + 0.6, 0.7, [2.6, 5], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(L(k.lineOnTop([0, strip.y + 0.6], [0, strip.y + 7.4], 0.7, P), { tone: "hi" }));
  out.push(D([at([strip.x + 2, strip.y + 4.5, 0.7]), at([strip.x + strip.w - 2, strip.y + 4.5, 0.7])], { size: 0.45 }));
  // label plate at the far end
  const label = { x: 318, y: -80, w: 44, d: 22, r: 1.6 };
  out.push(S(k.slabOf(label, 0, 0.9, P, 4), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.6), 0.9, P, 4), { tone: "faint" }));
  out.push(L([[322, -74, 30], [322, -69, 22], [322, -64, 26]].map(([x, y, w]) => k.lineOnTop([x, y], [x + w, y], 0.9, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([358, -76, 0.9]), at([358, -62, 0.9])], { size: 0.45 }));
  // dovetail rail on its end blocks
  out.push(S(box(RAIL.x0, RAIL.x1, -13, 13, 0, 3.2, 2, 1), { tone: "mid" }));
  out.push(S(box(RAIL.x0 + 2, RAIL.x1 - 2, -9.5, 9.5, 3.2, 8, 2, 0.6), { tone: "mid", inner: L(k.sideSeam({ x: RAIL.x0 + 2, y: -9.5, w: RAIL.x1 - RAIL.x0 - 4, d: 19, r: 0.6 }, 5.6, P, 2), { tone: "faint" }) }));
  out.push(L(k.lineOnTop([RAIL.x0 + 2, 0], [RAIL.x1 - 2, 0], 8, P), { tone: "faint" }));
  out.push(D([40, 120, 200, 280].map((x) => at([x, 0, 8])), { size: 0.45 }));
  for (const x of [RAIL.x0 - 6, RAIL.x1]) {
    out.push(S(box(x, x + 6, -15, 15, 0, 12, 3, 1.2), { tone: "mid" }));
    out.push(D([at([x + 3, -10, 12]), at([x + 3, 10, 12])], { size: 0.45 }));
  }
  return out.join("");
}

// A rider on the rail: block, lock screw, post.
function rider(cx, post, postTop) {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: cx - 20, y: -18, w: 40, d: 36, r: 3 }, 8, 0.1, P)}" style="filter:blur(4px)"/>`];
  const plan = { x: cx - 22, y: -19, w: 44, d: 38, r: 3 };
  out.push(S(k.slabOf(plan, 8, RIDER_TOP - 8, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(plan, 11, P, 4), { tone: "faint" }) }));
  out.push(D([cx - 16, cx + 16].flatMap((x) => [at([x, -13, RIDER_TOP]), at([x, 13, RIDER_TOP])]), { size: 0.45 }));
  // lock screw on the near side
  out.push(S(box(cx + 8, cx + 12, 19, 22, 10, 14, 2, 0.6), { tone: "mid", crease: "none" }));
  out.push(S(G.disc(0, 6, 3.4, G.frameOf([cx + 10, 22, 12], [0, 1, 0], [0, 0, 1], [1, 0, 0]), P), { tone: "mid" }));
  out.push(L(G.ribsOf(G.frameOf([cx + 10, 22, 12], [0, 1, 0], [0, 0, 1], [1, 0, 0]), 0, 6, 3.4, 20, P, { least: 0.15 }), { tone: "lo" }));
  // index pointer over the ruler
  out.push(S(box(cx - 1.4, cx + 1.4, 19, 25.5, 8.4, 9.4, 2, 0.3), { tone: "hi", crease: "lo" }));
  out.push(L(k.lineOnTop([cx, 21], [cx, 25.5], 9.4, P), { tone: "hi" }));
  if (post) {
    out.push(S(k.cylinder(cx, 0, post + 2.2, RIDER_TOP, 2.4, P, 28), { tone: "mid" }));
    out.push(S(k.cylinder(cx, 0, post, RIDER_TOP + 2.4, postTop - RIDER_TOP - 2.4, P, 28), { tone: "mid", crease: "none", inner: L(k.sideArc(cx, 0, post, (RIDER_TOP + postTop) / 2, P, 16), { tone: "faint" }) }));
  }
  return out.join("");
}

function cameraMount() {
  const out = [rider(0, 6.5, 26)];
  out.push(S(k.cylinder(0, 0, 9, 26, 3, P, 32), { tone: "mid" }));
  out.push(L(k.knurl(0, 0, 9, 26, 29, 40, P), { tone: "lo" }));
  // quick-release clamp and plate
  out.push(S(box(-15, 15, -17, 13, 29, 35, 3, 1.4), { tone: "mid" }));
  out.push(S(box(15, 18, -6, 6, 30, 34, 2, 0.6), { tone: "mid", crease: "none" }));
  out.push(S(G.disc(0, 4, 3, G.frameOf([18, 0, 32], [1, 0, 0], [0, 0, 1], [0, 1, 0]), P), { tone: "mid" }));
  out.push(L(G.ribsOf(G.frameOf([18, 0, 32], [1, 0, 0], [0, 0, 1], [0, 1, 0]), 0, 4, 3, 18, P, { least: 0.15 }), { tone: "lo" }));
  out.push(S(box(-13, 13, -21, 9, 35, 38.6, 3, 1), { tone: "lo" }));
  out.push(S(box(-11, 11, -19, 7, 38.6, 40, 2, 0.8), { tone: "lo", crease: "none" }));
  out.push(D([at([-11, 11.5, 35]), at([11, 11.5, 35])], { size: 0.45 }));
  return out.join("");
}

// ---------------------------------------------------------------- the camera body (far half)
const bodyRing = (() => {
  const r = 6;
  const ring = [[BODY.x1, 0]];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    ring.push([BODY.x1 - r + Math.cos(a) * r, BODY.y0 + r - Math.sin(a) * r]);
  }
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI / 2 + (i / 6) * (Math.PI / 2);
    ring.push([BODY.x0 + r + Math.cos(a) * r, BODY.y0 + r - Math.sin(a) * r]);
  }
  ring.push([BODY.x0, 0]);
  return ring;
})();

const HOLE_R = 22.6;
const opening = () => {
  const pts = [[IN.x0, 0, IN.z0], [IN.x1, 0, IN.z0], [IN.x1, 0, IN.z1], [IN.x0, 0, IN.z1]];
  const hole = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI;
    hole.push([BODY.x1, -Math.sin(a) * HOLE_R, AXZ + Math.cos(a) * HOLE_R]);
  }
  return pathOf(pts, true) + pathOf(hole, true);
};

function bodyShell() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: BODY.x0, y: BODY.y0, w: BODY.x1 - BODY.x0, d: -BODY.y0, r: 6 }, BODY.z0, 2, P)}" style="filter:blur(5px)"/>`);
  const shell = k.extrude(bodyRing, BODY.z0, BODY.z1 - BODY.z0, P, { bevel: 1.2 });
  const seam = k.ringSeam(bodyRing, BODY.z0 + 7, P);
  out.push(S(shell, { tone: "hi", crease: "lo", inner: L(seam, { tone: "faint" }) }));
  // the cut face is a section: paint it as one
  out.push(faceSvg([[BODY.x0, 0, BODY.z0], [BODY.x1, 0, BODY.z0], [BODY.x1, 0, BODY.z1], [BODY.x0, 0, BODY.z1]], P, { cls: "cam-cut", edge: "hi" }));
  // cavity behind the cut, and through the mount opening
  out.push(`<clipPath id="cam-open"><path d="${opening()}"/></clipPath>`);
  const cavity = [];
  cavity.push(faceSvg([[IN.x0, IN.y0, IN.z0], [IN.x1, IN.y0, IN.z0], [IN.x1, IN.y0, IN.z1], [IN.x0, IN.y0, IN.z1]], P, { edge: "lo", outline: false }));
  cavity.push(faceSvg([[IN.x0, IN.y0, IN.z0], [IN.x1, IN.y0, IN.z0], [IN.x1, 0, IN.z0], [IN.x0, 0, IN.z0]], P, { edge: "lo", outline: false }));
  cavity.push(faceSvg([[IN.x0, IN.y0, IN.z0], [IN.x0, 0, IN.z0], [IN.x0, 0, IN.z1], [IN.x0, IN.y0, IN.z1]], P, { edge: "lo", outline: false }));
  cavity.push(L(pathOf([[IN.x0, IN.y0, IN.z1], [IN.x0, IN.y0, IN.z0], [IN.x1, IN.y0, IN.z0]]) + pathOf([[IN.x0, IN.y0, IN.z0], [IN.x0, 0, IN.z0]]), { tone: "faint" }));
  // standoffs inside the far wall for the board screws
  for (const [x, z] of [[-6, 50], [-6, 98], [8, 98]]) cavity.push(S(G.disc(0, 3, 2, G.frameOf([x, IN.y0, z], [0, 1, 0], [0, 0, 1], [1, 0, 0]), P), { tone: "lo" }));
  out.push(`<g class="cam-cavity" clip-path="url(#cam-open)">${cavity.join("")}${interiorBack()}</g>`);
  out.push(L(pathOf([[IN.x0, 0, IN.z0], [IN.x1, 0, IN.z0], [IN.x1, 0, IN.z1], [IN.x0, 0, IN.z1]], true), { tone: "hi" }));
  return out.join("");
}

// A box cut by the section plane y = 0: the kit slab, with its near face painted as a cut.
function cutBox(x0, x1, y0, z0, z1, style = {}, r = 0.4, steps = 2) {
  const face = faceSvg([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], P, { cls: "cam-cut", edge: style.edge || "hi" });
  return S(box(x0, x1, y0, 0, z0, z1, steps, r), style) + face;
}

// What sits inside the far half: main board with the DIGIC 6, battery, card, flex, shutter motor.
function interiorBack() {
  const out = [];
  // battery LP-E12 and the SD card share the grip, loaded through the bottom door
  const bat = { x0: -12.8, x1: 8.8, y0: -59.4, y1: -46.4, z0: 42.2, z1: 74.8 };
  out.push(S(box(bat.x0, bat.x1, bat.y0, bat.y1, bat.z0, bat.z1, 3, 1.2), { tone: "mid", crease: "lo", inner: L(k.sideSeam({ x: bat.x0, y: bat.y0, w: bat.x1 - bat.x0, d: bat.y1 - bat.y0, r: 1.2 }, bat.z1 - 4, P, 3), { tone: "faint" }) }));
  out.push(S(box(-12.6, 11.4, -45.8, -44.9, 42.2, 77, 2, 0.2), { tone: "lo" }));
  out.push(S(box(-11.6, 10.4, -44.9, -42.8, 42.2, 74.2, 2, 0.6), { tone: "hi", crease: "lo" }));
  // main board on the floor, cut with the body; chips face up
  const bz = IN.z0 + 1.6;
  out.push(cutBox(IN.x0 + 0.4, IN.x1 - 1, -44, bz, bz + 1.4, { tone: "lo", crease: "faint", edge: "mid" }, 0.3));
  const top = bz + 1.4;
  out.push(`<g data-part="digic">${S(box(-13, -4, -15.5, -6, top, top + 1.3, 2, 0.4), { tone: "hi", crease: "lo" })}</g>`);
  out.push(k.faceTextSvg(k.topMatrix([-11.8, -9.4], top + 1.3, P, "x"), "DIGIC 6", { size: 1.45, tone: "mid" }));
  out.push(S(box(-13, -6, -26, -18.5, top, top + 1, 2, 0.3), { tone: "mid", crease: "lo" }));
  out.push(S(box(3, 10, -30, -22, top, top + 1, 2, 0.3), { tone: "mid", crease: "lo" }));
  out.push(D([[-2, -4], [-2, -7], [-2, -10], [1, -4], [1, -7], [-13.4, -2], [-10, -2], [6, -14], [9, -14], [6, -18]].map(([x, y]) => at([x, y, top])), { size: 0.5, tone: "mid" }));
  // board-to-board connector the flex lands on
  out.push(S(box(-3.4, 1.2, -15, -5, top, top + 1.6, 2, 0.3), { tone: "mid" }));
  // flex from the sensor board down to the main board, a ribbon bent in a U
  const path = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    path.push([-5.4 + Math.cos(a) * 1.8, 0, top + 6.8 - Math.sin(a) * 3.2]);
  }
  const run = [[-3.6, 0, 58], ...path, [-7.2, 0, top + 9.6], [-1.1, 0, top + 9.6], [-1.1, 0, top + 1.6]];
  const ribbon = [];
  for (let i = 0; i < run.length - 1; i++) {
    const [x0, , z0] = run[i];
    const [x1, , z1] = run[i + 1];
    ribbon.push(faceSvg([[x0, -14, z0], [x1, -14, z1], [x1, -6, z1], [x0, -6, z0]], P, { outline: false }));
  }
  const edge = (y) => pathOf(run.map(([x, , z]) => [x, y, z]));
  out.push(`<g data-part="flex">${ribbon.join("")}${L(edge(-6), { tone: "mid" })}<path data-part="flex-pulse" class="iso-line cam-pulse" data-tone="lit" d="${edge(-10)}"/></g>`);
  // rear board behind the sensor: buttons and the LCD driver, cut with the body
  out.push(cutBox(IN.x0, IN.x0 + 1.4, -44, 50, 100, { tone: "lo", crease: "faint", edge: "mid" }, 0.3));
  const rx = IN.x0 + 1.4;
  out.push(S(box(rx, rx + 1, -14, -4, 80, 90, 2, 0.3), { tone: "mid", crease: "lo" }));
  out.push(S(box(rx, rx + 0.8, -12, -5, 64, 70, 2, 0.3), { tone: "mid", crease: "lo" }));
  out.push(S(box(rx, rx + 1.6, -10, -2, 95, 98, 2, 0.3), { tone: "mid" }));
  out.push(D([[-3, 56], [-6, 56], [-9, 56], [-3, 74], [-7, 74], [-11, 76], [-16, 60], [-16, 94]].map(([y, z]) => at([rx, y, z])), { size: 0.45, tone: "mid" }));
  // LCD flex from the rear board up through the top wall to the hinge
  out.push(faceSvg([[rx + 1.6, -9.5, 98], [rx + 1.6, -2.5, 98], [rx + 1.6, -2.5, IN.z1], [rx + 1.6, -9.5, IN.z1]], P, { edge: "mid" }));
  // shutter charge motor and its gear, on the far side of the gate
  out.push(S(G.disc(0, 7, 3.2, alongX(-28, 58), P), { tone: "mid" }));
  out.push(L(G.arcOf(alongX(-28, 58), 3.5, 3.2, P), { tone: "faint" }));
  out.push(S(G.disc(7, 8, 4.4, alongX(-28, 58), P), { tone: "lo" }));
  out.push(L(G.ribsOf(alongX(-28, 58), 7, 8, 4.4, 26, P, { least: 0.1 }), { tone: "lo" }));
  // sensor tilt standoffs with springs, from the front wall to the sensor plate
  for (const z of [61, 87]) {
    const F = alongX(-17, z);
    out.push(S(G.disc(-4.6, IN.x1, 1.3, F, P), { tone: "mid", crease: "none" }));
    const c = k.coil(-4, 3.4, [-17, z], 2.6, 4, "x", P);
    out.push(L(c.back, { tone: "lo" }), L(c.front, { tone: "mid" }));
  }
  return out.join("");
}

// Sensor, filter and shutter, cut with the body.
function imagingUnit() {
  const out = [];
  out.push(cutBox(-6.2, -4.6, -20, 56, 92, { tone: "mid", crease: "faint" }, 1.2, 3));
  out.push(cutBox(-4.6, -3.2, -18, 58, 90, { tone: "lo", crease: "faint", edge: "mid" }));
  out.push(D([[-4.6, -18.6, 58.5], [-4.6, -18.6, 89.5]].map(at), { size: 0.6, tone: "hi" }));
  out.push(cutBox(-3.2, -0.6, -15.2, 62.4, 85.6, { tone: "hi", crease: "lo" }, 0.8));
  const w = CAMERA.sensor.w / 2;
  const h = CAMERA.sensor.h / 2;
  const area = [[-0.6, 0, AXZ + h], [-0.6, -w, AXZ + h], [-0.6, -w, AXZ - h], [-0.6, 0, AXZ - h]];
  out.push(`<g data-part="sensor">${faceSvg(area, P, { cls: "cam-die", edge: "mid" })}</g>`);
  out.push(`<path data-part="exposed" class="cam-exposed" d=""/>`);
  const pads = [];
  for (let i = 0; i < 8; i++) {
    const y = -12.5 + (i * 12) / 7;
    pads.push(at([-0.6, y, AXZ + h + 1.6]), at([-0.6, y, AXZ - h - 1.6]));
  }
  out.push(D(pads, { size: 0.35, tone: "mid" }));
  // cover glass, and the low-pass / IR-cut filter in its rubber frame
  out.push(`<g class="cam-glass">${cutBox(-0.6, 0.2, -13.6, 64, 84, { tone: "hi", crease: "faint", edge: "mid" })}</g>`);
  out.push(cutBox(0.6, 2.6, -14.4, 63.4, 84.6, { tone: "lo", crease: "faint", edge: "mid" }, 1.2));
  out.push(`<g class="cam-glass">${cutBox(1.2, 2.8, -12.6, 65.2, 82.8, { tone: "hi", crease: "faint", edge: "mid" }, 0.6)}</g>`);
  // shutter: rear frame, curtains (drawn live), front frame
  const { x0, x1 } = SHUTTER;
  const zb = AXZ - 20;
  const zt = AXZ + 21;
  out.push(cutBox(x0, x0 + 1, -24, zb, AXZ - GATE.z, { tone: "mid" }));
  out.push(S(box(x0, x0 + 1, -24, -GATE.y, AXZ - GATE.z, AXZ + GATE.z, 2, 0.2), { tone: "mid" }));
  out.push(cutBox(x0, x0 + 1, -24, AXZ + GATE.z, zt, { tone: "mid" }));
  out.push(`<g data-part="curtains"></g>`);
  out.push(S(box(x0 + 1, x1 - 1, -24, -21, zb, zt, 2, 0.4), { tone: "mid", crease: "faint" }));
  out.push(cutBox(x1 - 1, x1, -24, zb, AXZ - GATE.z, { tone: "mid", crease: "faint" }));
  out.push(cutBox(x1 - 1, x1, -24, AXZ + GATE.z, zt, { tone: "mid", crease: "faint" }));
  out.push(S(box(x1 - 1, x1, -24, -GATE.y, AXZ - GATE.z, AXZ + GATE.z, 2, 0.2), { tone: "mid", crease: "faint" }));
  out.push(D([[x1, -21, zb + 3], [x1, -21, zt - 3], [x1, -6, zb + 3], [x1, -6, zt - 3]].map(at), { size: 0.5, tone: "hi" }));
  out.push(L(pathOf([[x1, 0, AXZ - GATE.z], [x1, -GATE.y, AXZ - GATE.z], [x1, -GATE.y, AXZ + GATE.z], [x1, 0, AXZ + GATE.z]]), { tone: "lo" }));
  return out.join("");
}

function grip() {
  const ring = k.ringOf({ x: BODY.x1 - 3, y: -60, w: 8, d: 17, r: 3.8 }, 4);
  const out = [S(k.extrude(ring, 46, 52, P, { bevel: 0.8 }), { tone: "mid", crease: "faint" })];
  const dots = [];
  for (let z = 52; z <= 92; z += 3.2) for (const y of [-56, -53, -50, -47]) dots.push(at([BODY.x1 + 5, y, z]));
  out.push(D(dots, { size: 0.32, tone: "lo" }));
  // lens release button and mount index
  out.push(S(G.disc(BODY.x1, BODY.x1 + 1.6, 3.4, alongX(-33, 54), P), { tone: "mid" }));
  out.push(S(G.disc(BODY.x1 + 1.6, BODY.x1 + 2.4, 2.6, alongX(-33, 54), P), { tone: "hi" }));
  return out.join("");
}

function topControls() {
  const out = [];
  const z = BODY.z1;
  // microphone holes
  out.push(D([-6, -3, 0, 3].flatMap((x) => [at([x, -14, z]), at([x, -17, z])]), { size: 0.4, tone: "lo" }));
  // power and movie buttons
  out.push(S(k.cylinder(-8, -52, 2.6, z, 1, P, 20), { tone: "mid" }));
  out.push(S(k.cylinder(-6, -31, 2.4, z, 1, P, 20), { tone: "mid" }));
  out.push(L(k.ring(-6, -31, 1, z + 1, P, 16), { tone: "lo" }));
  // main dial ring with a pointer, and the shutter button inside it
  out.push(S(k.cylinder(6, -46, 7.4, z, 1.2, P, 40), { tone: "lo" }));
  out.push(`<g data-part="dial">${S(k.cylinder(6, -46, 6.6, z + 1.2, 2.6, P, 40, 0.4), { tone: "mid" })}${L(k.knurl(6, -46, 6.6, z + 1.2, z + 3.8, 48, P), { tone: "lo" })}</g>`);
  out.push(`<path data-part="dial-mark" class="iso-line" data-tone="hi" data-free="end" d=""/>`);
  out.push(`<g data-part="button">${S(k.cylinder(6, -46, 3.9, z + 2.6, 2.4, P, 32, 0.4), { tone: "hi", crease: "lo" })}</g>`);
  // LCD hinges and the arms that carry the panel
  for (const [y0, y1] of [[-43, -33], [-13, -3]]) {
    out.push(S(G.disc(y0, y1, 1.8, alongY(PANEL.h[0], PANEL.h[2]), P), { tone: "mid" }));
    out.push(S(G.disc(0, PANEL.gap + 0.2, 1.3, G.frameAlong([PANEL.h[0], (y0 + y1) / 2, PANEL.h[2]], PANEL.d), P), { tone: "mid", crease: "none" }));
  }
  return out.join("");
}

// The tilting 3.0" LCD, swung up 150 degrees about its hinge so it faces forward and up
function lcd() {
  const out = [];
  const W = (LCD.y1 - LCD.y0) / 2;
  const H = (LCD.z1 - LCD.z0) / 2;
  const rr = 3.6;
  const poly = [];
  for (const [cx, cy, a0] of [[W - rr, H - rr, 0], [-W + rr, H - rr, 90], [-W + rr, -H + rr, 180], [W - rr, -H + rr, 270]]) {
    for (let i = 0; i <= 5; i++) {
      const a = ((a0 + (i / 5) * 90) * Math.PI) / 180;
      poly.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  const F = G.frameOf(PANEL.c, PANEL.n, [0, 1, 0], PANEL.d);
  out.push(S(G.prismOf(F, poly, -3, 3, P), { tone: "mid", crease: "faint" }));
  const Sc = G.add3(PANEL.c, G.mul3(PANEL.n, 3));
  const corner = (sy, sd, grow = 0) => G.add3(Sc, G.add3([0, sy * (SCREEN.w / 2 + grow), 0], G.mul3(PANEL.d, sd * (SCREEN.h / 2 + grow))));
  const rect = (grow) => [corner(1, 1, grow), corner(-1, 1, grow), corner(-1, -1, grow), corner(1, -1, grow)];
  out.push(L(pathOf(rect(1.6), true), { tone: "lo" }));
  out.push(`<clipPath id="cam-screen"><path d="${pathOf(rect(0), true)}"/></clipPath>`);
  out.push(`<path class="cam-screen" d="${pathOf(rect(0), true)}"/>`);
  const m = planeMatrix(corner(1, 1), [0, -1, 0], G.mul3(PANEL.d, -1), P);
  out.push(`<g clip-path="url(#cam-screen)"><g data-part="lcd" transform="${m}">${photoSvg("lcd")}</g></g>`);
  out.push(L(pathOf(rect(0), true), { tone: "mid" }));
  const low = G.add3(Sc, G.mul3(PANEL.d, -(SCREEN.h / 2 + 2.8)));
  out.push(D([G.add3(low, [0, SCREEN.w / 2, 0]), G.add3(low, [0, -SCREEN.w / 2, 0])].map(at), { size: 0.4, tone: "lo" }));
  return out.join("");
}

// The picture as the camera sees it, in local screen units (63.4 x 42.3 for the LCD).
const KING = [[0.0,9.86], [1.81,9.86], [2.38,9.2], [2.96,9.2], [3.78,7.89,1], [4.93,6.82,1], [5.75,6.24], [6.24,6.98], [7.06,6.98], [7.72,5.83], [9.04,5.01,1], [13.14,4.19,1], [19.71,3.53,1], [24.64,3.29,1], [26.78,3.53], [27.27,5.26], [28.42,5.26], [28.91,3.86], [29.9,4.03,1], [32.86,5.34,1], [35.65,6.33,1], [37.13,6.16], [37.62,4.76], [38.61,2.96], [39.1,0.0]];
const KING_TOP = 46;
const kingOutline = () => {
  const right = KING.map(([s, r]) => [r, s]);
  const left = [...KING].reverse().map(([s, r]) => [-r, s]);
  const cross = [[0.9, 39.1], [0.9, 42.1], [3.1, 42.1], [3.1, 43.9], [0.9, 43.9], [0.9, KING_TOP], [-0.9, KING_TOP], [-0.9, 43.9], [-3.1, 43.9], [-3.1, 42.1], [-0.9, 42.1], [-0.9, 39.1]];
  const pts = [...right.slice(0, -1), ...cross, ...left.slice(1)];
  return "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${(-y).toFixed(2)}`).join("L") + "Z";
};

function photoSvg(id) {
  return `<rect class="cam-photo-bg" x="-40" y="-40" width="160" height="140"/>
<g data-part="${id}-scene" filter="url(#${id}-blur)"><rect class="cam-photo-wall" x="-40" y="-40" width="160" height="140"/><g data-part="${id}-king"><path class="cam-photo-stage" d="M-18 0H18V4H-18Z M-5 4H5V40H-5Z"/><path class="cam-photo-king" d="${kingOutline()}"/><path class="cam-photo-shine" d="${kingOutline()}"/></g></g>
<rect data-part="${id}-dark" class="cam-photo-dark" x="-40" y="-40" width="160" height="140" opacity="0"/><rect data-part="${id}-bright" class="cam-photo-bright" x="-40" y="-40" width="160" height="140" opacity="0"/>
<g data-part="${id}-info" class="cam-osd"><text x="3" y="5">45mm</text><text x="60.4" y="5" text-anchor="end">0001</text><text x="3" y="40" data-part="${id}-text"></text><path class="cam-af" data-part="${id}-af" d="M27.7 17.2h-1.6v1.6M35.7 17.2h1.6v1.6M27.7 25.2h-1.6v-1.6M35.7 25.2h1.6v-1.6"/></g>
<rect data-part="${id}-black" class="cam-photo-black" x="-40" y="-40" width="160" height="140" opacity="0"/>`;
}

// ---------------------------------------------------------------- the lens (far half)
const ELEMENTS = [
  // centre s, thickness, half aperture, front curvature, back curvature, group
  [77.6, 1.6, 20.5, 1 / 90, -1 / 40, 1],
  [71, 4.4, 15.5, 1 / 45, 1 / 120, 2],
  [66, 1.2, 12, -1 / 60, -1 / 50, 3],
  [61.4, 5.4, 11, 1 / 30, 1 / 25, 4],
  [58.1, 1.2, 11, -1 / 25, 0, 4],
  [52, 3.2, 9.5, 1 / 35, 1 / 60, 5],
  [45, 3, 10.5, 1 / 40, 1 / 80, 6],
  [38.5, 1.4, 12.5, -1 / 40, -1 / 100, 7],
  [33, 4.2, 13.5, 1 / 50, 1 / 50, 8],
  [26, 2.4, 14.5, -1 / 80, 1 / 45, 9],
];
const FOCUS_GROUP = 6;
const TUBES = [
  ["mount", [[18, 23.6], [21.5, 23.6], [21.5, 27.6], [18, 27.6]], "mid"],
  ["rear", [[21.5, 24.8], [31, 24.8], [31, 29.4], [24, 29.4], [21.5, 27.8]], "mid"],
  ["zoom", [[31, 27.6], [62, 27.6], [62, 30.45], [31, 30.45]], "mid"],
  ["cam", [[31, 22.4], [62, 22.4], [62, 23.6], [31, 23.6]], "lo"],
  ["inner", [[62, 24.8], [69, 24.8], [69, 27.2], [62, 27.2]], "mid"],
  ["focus", [[69, 24.8], [77, 24.8], [77, 28.6], [69, 28.6]], "mid"],
  ["front", [[77, 22.8], [81.4, 22.8], [81.4, 26.4], [77, 26.4]], "mid"],
];
const holderOuter = (s) => (s < 31 ? 24.8 : s < 62 ? 22.4 : s < 77 ? 24.8 : 22.8);

function lens() {
  const back = [];
  const front = [];
  const sections = [];
  // body mount ring, stainless, cut with the body
  const mount = halfTurn([[13.7, 23.2], [18, 23.2], [18, 28.8], [15.5, 28.8], [15.5, 25.2], [13.7, 25.2]], AXIS, P, { steps: 36 });
  back.push(turnSvg(mount, P, { sections: false }));
  sections.push(sectionSvg(mount, P));
  const contacts = [];
  for (let i = 0; i < 5; i++) contacts.push(at(turnAt(AXIS, 18, 24.4, Math.PI - 0.08 - i * 0.12)));
  const tubes = TUBES.map(([name, prof, tone]) => ({ name, part: halfTurn(prof, AXIS, P, { steps: 40 }), tone }));
  tubes.sort((a, b) => a.part.depth - b.part.depth);
  for (const { name, part, tone } of tubes) {
    let inner = "";
    if (name === "zoom") inner = ribs(31.6, 61.4, 30.45, 46);
    if (name === "focus") inner = ribs(69.6, 76.4, 28.6, 54);
    if (name === "cam") inner = camSlots();
    back.push(`<g data-tone-set="${tone}">${turnSvg(part, P, { sections: false })}${inner}</g>`);
    sections.push(sectionSvg(part, P));
  }
  back.push(D(contacts, { size: 0.45, tone: "hi" }));
  // STM focus motor and lead screw, between the cam barrel and the zoom ring
  const MA = 2.55;
  const mc = turnAt(AXIS, 0, 25.6, MA);
  const MF = G.frameOf(mc, [1, 0, 0], [0, 0, 1], [0, -1, 0]);
  back.push(S(G.disc(32, 41, 1.9, MF, P), { tone: "mid" }));
  back.push(L(G.arcOf(MF, 36.5, 1.9, P), { tone: "faint" }));
  back.push(S(G.disc(41, 55, 0.6, MF, P), { tone: "hi", crease: "none" }));
  // the parts that move: holders, elements, stop
  const items = [];
  ELEMENTS.forEach(([sc, t, a, c1, c2, group], index) => {
    const prof = elementProfile(sc, t, a, c1, c2);
    const glass = halfTurn(prof, AXIS, P, { axis: true, steps: 28 });
    const edgeF = prof[prof.length / 2 - 1][0];
    const edgeB = prof[prof.length / 2][0];
    const s0 = Math.min(edgeF, edgeB) - 0.5;
    const s1 = Math.max(edgeF, edgeB) + 0.5;
    const holder = halfTurn([[s0, a + 0.15], [s1, a + 0.15], [s1, a + 1.6], [s1 - 0.6, a + 1.6], [s1 - 0.6, holderOuter(sc)], [s0, holderOuter(sc)]], AXIS, P, { steps: 28 });
    items.push({ s: sc, group, index, glass, holder });
  });
  const stopHousing = halfTurn([[STOP_S - 1, 13], [STOP_S + 1.4, 13], [STOP_S + 1.4, 22.4], [STOP_S - 1, 22.4]], AXIS, P, { steps: 40 });
  const isMagnet = halfTurn([[50, 16.5], [54.4, 16.5], [54.4, 21.6], [50, 21.6]], AXIS, P, { from: 1.25, to: 1.9, steps: 10 });
  const order = [...items].sort((a, b) => a.s - b.s);
  for (const item of order) {
    const holderSvg = turnSvg(item.holder, P, { sections: false });
    const glassSvg = `<g class="cam-glass">${turnSvg(item.glass, P, { sections: false, edge: "mid" })}</g>`;
    const sec = sectionSvg(item.holder, P) + `<g class="cam-glass">${sectionSvg(item.glass, P, { sectionCls: "cam-glass-cut", edge: "hi" })}</g>`;
    if (item.group === FOCUS_GROUP) {
      const nut = turnAt(AXIS, item.s, 25.6, MA);
      const arm = S(G.prismOf(G.frameOf(turnAt(AXIS, 0, 0, MA), [1, 0, 0], [0, 0, 1], [0, -1, 0]), [[-1.2, 20], [1.2, 20], [1.2, 27.4], [-1.2, 27.4]].map(([w, r]) => [Math.cos(MA) * r - Math.sin(MA) * w, Math.sin(MA) * r + Math.cos(MA) * w]), item.s - 1.6, item.s + 1.6, P), { tone: "mid" });
      front.push(`<g data-part="focus-group">${holderSvg}${glassSvg}${arm}${D([at(nut)], { size: 0.5, tone: "hi" })}${sec}</g>`);
    } else {
      front.push(holderSvg + glassSvg);
      sections.push(sec);
    }
    if (item.index === 5) {
      front.push(turnSvg(isMagnet, P, { sections: true }));
    }
    if (item.index === 4) {
      front.push(turnSvg(stopHousing, P, { sections: false }));
      sections.push(sectionSvg(stopHousing, P));
      front.push(`<g data-part="blades"></g>`);
    }
  }
  return { back: back.join(""), front: front.join(""), sections: sections.join("") };
}

function ribs(s0, s1, r, count) {
  const V = G.viewOf(P);
  const out = [];
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI;
    const n = [0, -Math.sin(a), Math.cos(a)];
    const f = G.dot3(n, V);
    const alpha = G.fadeOf(f, [0.04, 0.4]);
    if (alpha < 0.03) continue;
    out.push({ d: k.pathOf([at(turnAt(AXIS, s0, r, a)), at(turnAt(AXIS, s1, r, a))]), alpha });
  }
  const seams = [s0, s1].map((s) => {
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI;
      if (G.dot3([0, -Math.sin(a), Math.cos(a)], V) > 0) pts.push(at(turnAt(AXIS, s, r, a)));
    }
    return k.pathOf(pts);
  });
  return k.fadedSvg(out, { tone: "lo" }) + L(seams.join(""), { tone: "lo" });
}

// zoom cam slots on the inside of the cam barrel: closed outlines, seen where the inner wall faces us
function camSlots() {
  const V = G.viewOf(P);
  const out = [];
  for (const [s0, s1, a0, a1] of [[34, 52, 0.75, 1.55], [40, 58, 1.9, 2.7]]) {
    const side = [];
    const other = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const s = s0 + (s1 - s0) * t;
      const a = a0 + (a1 - a0) * t;
      side.push(turnAt(AXIS, s - 0.9, 22.45, a));
      other.push(turnAt(AXIS, s + 0.9, 22.45, a));
    }
    const n = [0, Math.sin((a0 + a1) / 2), -Math.cos((a0 + a1) / 2)];
    if (G.dot3(n, V) <= 0) continue;
    out.push(k.pathOf([...side, ...other.reverse()].map(at), true));
  }
  return L(out.join(""), { tone: "faint" });
}

// ---------------------------------------------------------------- lamp and subject
function lamp() {
  const out = [];
  const { x, y } = LAMP;
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: x - 16, y: y - 16, w: 32, d: 32, r: 16 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`);
  out.push(S(k.cylinder(x, y, 16, 0, 4, P, 48, 0.8), { tone: "mid" }));
  out.push(L(k.ring(x, y, 12, 4, P, 40), { tone: "faint" }));
  out.push(S(k.cylinder(x, y, 4.6, 4, 3, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 2.2, 7, 98, P, 20), { tone: "mid", crease: "none" }));
  const joint = [x, y, 107];
  out.push(S(G.sphereOf(joint, 4, P), { tone: "mid" }));
  const head = [x + 16, y + 10, 118];
  const dir = G.unit3(G.sub3([S_REST, 0, KING_Z + 24], head));
  const armDir = G.unit3(G.sub3(head, joint));
  out.push(S(G.disc(3.8, G.len3(G.sub3(head, joint)) - 3, 1.6, G.frameAlong(joint, armDir), P), { tone: "mid", crease: "none" }));
  const F = G.frameAlong(head, dir);
  out.push(S(G.sphereOf(head, 3.4, P), { tone: "mid" }));
  out.push(S(G.solidOf([[-10, 0], [-10, 4.4], [-6, 5.2, 1], [-1, 8.6, 1], [4, 13.2, 1], [8, 15.4]], F, P), { tone: "hi", crease: "lo", inner: L(G.arcOf(F, -6, 5.2, P), { tone: "faint" }) }));
  // the open mouth faces the king: lip, the lit inside and the bulb
  out.push(`<path class="cam-lamp-mouth" d="${G.circleOf(F, 8, 14.6, P)}"/>`);
  out.push(S(G.sphereOf(G.add3(head, G.mul3(dir, 3)), 4.2, P), { tone: "hi", lit: true }));
  out.push(S(G.ringBand(7.4, 8.6, 14.4, 15.8, F, P), { tone: "hi" }));
  return out.join("");
}

function subject() {
  const out = [rider(0, 5, KING_Z - 4)];
  out.push(S(k.cylinder(0, 0, 18, KING_Z - 4, 4, P, 56, 0.6), { tone: "mid" }));
  out.push(L(k.knurl(0, 0, 18, KING_Z - 4, KING_Z, 72, P), { tone: "lo" }));
  out.push(L(k.ring(0, 0, 14, KING_Z, P, 48), { tone: "faint" }));
  const F = G.frameOf([0, 0, KING_Z], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: -11, y: -11, w: 22, d: 22, r: 11 }, KING_Z, 0.1, P)}" style="filter:blur(3px);opacity:.5"/>`);
  out.push(S(G.solidOf(KING, F, P), { tone: "hi", crease: "lo", inner: L(G.arcOf(F, 2.96, 9.2, P) + G.arcOf(F, 28.4, 5.26, P), { tone: "faint" }) }));
  const zc = KING_Z;
  out.push(S(k.slabOf({ x: -0.9, y: -0.9, w: 1.8, d: 1.8, r: 0.3 }, zc + 38.8, 42.1 - 38.8, P, 2), { tone: "hi", crease: "lo" }));
  out.push(S(k.slabOf({ x: -0.9, y: -3.1, w: 1.8, d: 6.2, r: 0.3 }, zc + 42.1, 1.8, P, 2), { tone: "hi", crease: "lo" }));
  out.push(S(k.slabOf({ x: -0.9, y: -0.9, w: 1.8, d: 1.8, r: 0.3 }, zc + 43.9, KING_TOP - 43.9, P, 2), { tone: "hi", crease: "lo" }));
  return out.join("");
}

// ---------------------------------------------------------------- assemble
const LENS = lens();
const defs = `<defs><linearGradient id="cam-light" x1="0" x2="1"><stop offset="0" stop-color="var(--cam-ivory)" stop-opacity="0"/><stop offset=".55" stop-color="var(--cam-ivory)" stop-opacity=".55"/><stop offset="1" stop-color="var(--cam-ivory)" stop-opacity="1"/></linearGradient>${["lcd"].map((id) => `<filter id="${id}-blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur data-part="${id}-sigma" stdDeviation="0"/></filter>`).join("")}</defs>`;
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "A Canon EOS M10 cut in half along its lens axis, clamped on an optical bench and aimed at a chess king on a sliding rider. Light from the king passes through the ten glass elements of the kit lens and the seven-blade aperture, through the shutter gate onto the sensor; the picture then goes down a flex cable to the DIGIC 6 processor and the SD card and appears on the flipped-up screen.",
  body: [
    defs,
    bench(),
    cameraMount(),
    bodyShell(),
    imagingUnit(),
    lcd(),
    topControls(),
    grip(),
    LENS.back,
    LENS.front,
    LENS.sections,
    `<g data-part="rays"></g>`,
    lamp(),
    `<g data-part="subject" transform="${k.translateAlong(P, [S_REST, 0, 0])}">${subject()}</g>`,
  ],
});

const exp0 = exposureOf(8, 1 / 125);
const live = readFileSync(join(HERE, "live.js"), "utf8");
const config = `
const P = ${JSON.stringify(P)};
const CAMERA = ${JSON.stringify(CAMERA)};
const AXZ = ${AXZ}, STOP_S = ${STOP_S}, S_RANGE = ${JSON.stringify(S_RANGE)}, S_REST = ${S_REST}, KING_Z = ${KING_Z}, KING_TOP = ${KING_TOP};
const KING = ${JSON.stringify(KING)};
const GATE = ${JSON.stringify(GATE)}, SHUTTER = ${JSON.stringify(SHUTTER)};
const FOCUS_S = ${ELEMENTS[FOCUS_GROUP][0]};
const SCREEN = ${JSON.stringify(SCREEN)};
${imageDistance.toString()}
${exposureOf.toString()}
const THIRDS = (() => { const out = []; for (let iso = 100; iso <= 12800 * 1.01; iso *= Math.cbrt(2)) out.push(iso); return out; })();
const NOMINAL = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800];
`;

const controls = `<div class="cam-controls" role="group" aria-label="Exposure settings">
<span class="cam-control"><span class="cam-control-label">Aperture</span>${CAMERA.apertures.map((N) => `<button type="button" data-aperture="${N}"${N === 8 ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${fLabel(N)}</button>`).join("")}</span>
<span class="cam-control"><span class="cam-control-label">Shutter</span>${CAMERA.speeds.map((t) => `<button type="button" data-speed="${t}"${Math.round(1 / t) === 125 ? ' aria-pressed="true"' : ' aria-pressed="false"'}>${speedLabel(t).replace(" s", "")}</button>`).join("")}</span>
</div>`;

const body = k.plateHtml({
  fig: "Fig 1",
  title: "Canon EOS M10, cut in half",
  hint: "Hover to move the king · click to shoot",
  readout: `0.29 m · f/8 · 1/125 s · ISO ${exp0.iso}`,
  keys: [
    { mark: "lit", label: "Light from the king, bent by the lens onto the sensor" },
    { mark: "raised", label: "10 elements in 9 groups; the focus group rides a lead screw" },
    { mark: "edge", label: "Cut faces of the body, mount and lens barrel" },
    { mark: "dim", label: "Flex to the DIGIC 6, then the SD card" },
  ],
  caption:
    "Half-press focuses: the stepping motor turns its lead screw and slides one lens group until the king's image lands sharp on the 22.3 × 14.9 mm sensor. A full press shuts the gate, then the first curtain falls to start the exposure and the second follows it the shutter time later to end it (here 100 times slower than life). At 1/4000 s the two curtains travel together as a slit only a fraction of a millimetre wide. The aperture blades close to the f-number first, and auto ISO makes up the rest of the exposure; when it runs out of range the picture comes out dark or bright. The 18-million-pixel frame is read out row by row, processed by the DIGIC 6 and written to the card.",
  body: `<div class="iso-stage cam-stage" tabindex="0" role="application" aria-label="Cutaway camera. Arrow keys move the king, F focuses, Space takes a picture, A and S change aperture and shutter speed.">${svg}</div>${controls}`,
});

const css = readFileSync(join(HERE, "camera.css"), "utf8");
const TITLE = "EOS M10 Cutaway";
const page = k
  .pageHtml({ title: TITLE, theme: "dark", body: `<style>${css}</style>${body}`, script: kitScript() + config + live, width: 820 })
  .replace(/(<body[^>]*>)/, `$1<script>${THEME}</script>`);
writeFileSync(join(ROOT, "docs/index.html"), page);
console.log("wrote docs/index.html", (page.length / 1024).toFixed(0) + " KB");

if (artifactAt) {
  // the same page as a fragment: the host supplies <html>, <head> and <body>
  const style = page.match(/<head>.*?(<style>.*?<\/style>)<\/head>/s)[1];
  const inner = page.match(/<body[^>]*>(.*)<\/body>/s)[1];
  writeFileSync(artifactAt, `<title>${TITLE}</title>${style}${inner}`);
  console.log("wrote", artifactAt);
}
