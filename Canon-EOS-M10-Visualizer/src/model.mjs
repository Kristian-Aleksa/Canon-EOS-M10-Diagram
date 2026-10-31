// The camera as numbers. Everything the figure shows or moves comes from here.
// Canon EOS M10 with the EF-M 15-45mm f/3.5-6.3 IS STM kit lens, zoomed to 45 mm.

export const CAMERA = {
  sensor: { w: 22.3, h: 14.9, px: [5184, 3456] }, // APS-C CMOS, 18.0 MP
  flange: 18, // EF-M flange focal distance, mm
  focal: 45, // mm, tele end of the kit zoom
  apertures: [6.3, 8, 11, 16, 22], // f/6.3 is wide open at 45 mm
  speeds: [1 / 30, 1 / 60, 1 / 125, 1 / 250, 1 / 500, 1 / 1000, 1 / 4000],
  isoMin: 100,
  isoMax: 12800,
  sceneEV: 9, // EV at ISO 100 for the lamp-lit chess piece
  travel: 3.6, // ms for a shutter curtain to cross the 14.9 mm gate
  slow: 100, // the figure shows the shutter 100 times slower than life
  blades: 7,
  elements: 10,
  groups: 9,
};

export const pitch = CAMERA.sensor.w / CAMERA.sensor.px[0]; // mm per pixel, about 4.3 um

// Thin lens with its principal plane `v` in front of the sensor: subject at `s` from the sensor plane.
export function imageDistance(s, f = CAMERA.focal) {
  const root = Math.sqrt(Math.max(0, s * s - 4 * f * s));
  const u = (s + root) / 2;
  return s - u;
}
export const objectDistance = (s, f = CAMERA.focal) => s - imageDistance(s, f);
export const magnification = (s, f = CAMERA.focal) => imageDistance(s, f) / objectDistance(s, f);

// Blur circle on the sensor when the lens is set for `focus` and the subject sits at `s`.
export function blurOf(s, focus, N, f = CAMERA.focal) {
  const pupil = f / N;
  const vs = imageDistance(s, f);
  const vf = imageDistance(focus, f);
  return (pupil * Math.abs(vs - vf)) / vs; // mm
}

// Auto ISO in third stops, clamped to the camera's range.
const THIRDS = (() => {
  const out = [];
  for (let iso = 100; iso <= 12800 * 1.01; iso *= Math.cbrt(2)) out.push(iso);
  return out;
})();
const NOMINAL = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800];

export function exposureOf(N, t, ev = CAMERA.sceneEV) {
  const wanted = (100 * N * N) / (t * 2 ** ev);
  let index = 0;
  THIRDS.forEach((iso, at) => {
    if (Math.abs(Math.log2(iso / wanted)) < Math.abs(Math.log2(THIRDS[index] / wanted))) index = at;
  });
  const iso = THIRDS[index];
  return { iso: NOMINAL[index], error: Math.log2(iso / wanted) }; // error in stops: + over, - under
}

export const speedLabel = (t) => (t >= 1 ? `${t} s` : `1/${Math.round(1 / t)} s`);
export const fLabel = (N) => `f/${N}`;
