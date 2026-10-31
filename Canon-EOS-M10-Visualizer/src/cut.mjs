// Sectioned parts: turned bodies with the near half cut away along the plane through their axis,
// and flat faces anywhere in space. Shaded with the kit's own light and four tones.
import { iso, pathOf } from "../vendor/anatomy-kit/iso-kit.mjs";
import { viewOf, lightOf, bandOf, dot3, add3, sub3, mul3, cross3, unit3 } from "../vendor/anatomy-kit/lathe.mjs";

const TAU = Math.PI * 2;
const toneClass = (tone) => (tone >= 4 ? `class="iso-top"` : `class="iso-shade" data-shade="${tone}"`);
export const toneOfNormal = (n, P) => bandOf(dot3(unit3(n), lightOf(P)));
export const facing = (n, P) => dot3(n, viewOf(P)) > 1e-6;

export const at = (F, s, r, angle) => {
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  return [0, 1, 2].map((i) => F.o[i] + F.a[i] * s + r * (F.u[i] * c + F.v[i] * sn));
};
const radial = (F, angle) => [0, 1, 2].map((i) => F.u[i] * Math.cos(angle) + F.v[i] * Math.sin(angle));

// A flat polygon in space, shaded by its normal. Returns "" when it faces away.
export function faceSvg(points, P, { cls = "", tone, edge = "hi", outline = true, force = false } = {}) {
  const n = unit3(cross3(sub3(points[1], points[0]), sub3(points[2], points[0])));
  const normal = facing(n, P) ? n : mul3(n, -1);
  if (!force && !facing(n, P) && !facing(mul3(n, -1), P)) return "";
  const d = pathOf(points.map((p) => iso(p, P)), true);
  const t = tone ?? toneOfNormal(normal, P);
  return `<g class="iso-solid${cls ? " " + cls : ""}"><path class="iso-fill" d="${d}"/><path ${toneClass(t)} d="${d}"/>${outline ? `<path class="iso-line" data-tone="${edge}" d="${d}"/>` : ""}</g>`;
}

// A body of revolution about F.a, kept only for angles in [from, to] (angle 0 along F.u, toward F.v).
// `profile` is a list of [s, r] points. With `axis: true` it runs from the axis back to the axis
// (a lens element); otherwise it is a closed ring (a tube wall, a holder).
export function halfTurn(profile, F, P, { from = 0, to = Math.PI, steps = 40, axis = false, sharp = 0.5, section = "" } = {}) {
  const V = viewOf(P);
  const L = lightOf(P);
  const ring = profile.map((p) => [p[0], p[1]]);
  const closed = !axis;
  const edges = closed ? ring.length : ring.length - 1;
  // orientation: make the meridian normal point away from the material
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [s0, r0] = ring[i];
    const [s1, r1] = ring[(i + 1) % ring.length];
    area += s0 * r1 - s1 * r0;
  }
  const sign = area > 0 ? 1 : -1;
  const meridianNormal = (i) => {
    const [s0, r0] = ring[i];
    const [s1, r1] = ring[(i + 1) % ring.length];
    const len = Math.hypot(s1 - s0, r1 - r0) || 1;
    return [((r1 - r0) / len) * sign, (-(s1 - s0) / len) * sign];
  };
  const angles = Array.from({ length: steps + 1 }, (_, j) => from + ((to - from) * j) / steps);
  const normalAt = (i, angle) => {
    const [ns, nr] = meridianNormal(i);
    return add3(mul3(F.a, ns), mul3(radial(F, angle), nr));
  };
  const facets = [];
  const grid = [];
  for (let i = 0; i < edges; i++) {
    grid.push([]);
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    for (let j = 0; j < steps; j++) {
      const mid = (angles[j] + angles[j + 1]) / 2;
      if (a[1] < 1e-6 && b[1] < 1e-6) {
        grid[i].push(null);
        continue;
      }
      const n = normalAt(i, mid);
      const corners = [at(F, a[0], a[1], angles[j]), at(F, b[0], b[1], angles[j]), at(F, b[0], b[1], angles[j + 1]), at(F, a[0], a[1], angles[j + 1])];
      const centre = mul3(corners.reduce(add3), 0.25);
      const seen = dot3(n, V) > 0;
      const f = { i, j, seen, n, corners, depth: dot3(centre, V), tone: bandOf(dot3(unit3(n), L)), lines: [] };
      grid[i].push(f);
      if (seen) facets.push(f);
    }
  }
  const sharpAt = (i) => {
    // vertex i joins edge i-1 and edge i
    if (!closed && (i === 0 || i === ring.length - 1)) return false;
    if (profile[i][2]) return false;
    const p = ring[(i - 1 + ring.length) % ring.length];
    const q = ring[i];
    const r = ring[(i + 1) % ring.length];
    const u = unit3([q[0] - p[0], q[1] - p[1], 0]);
    const w = unit3([r[0] - q[0], r[1] - q[1], 0]);
    return dot3(u, w) < Math.cos(sharp);
  };
  const seg = (p, q) => pathOf([iso(p, P), iso(q, P)]);
  for (const f of facets) {
    const { i, j } = f;
    const [c0, c1, c2, c3] = f.corners;
    // ring-arc sides: at vertex i (c0-c3) and vertex i+1 (c1-c2)
    const prevI = closed ? (i - 1 + edges) % edges : i - 1;
    const nextI = closed ? (i + 1) % edges : i + 1;
    const before = prevI >= 0 ? grid[prevI][j] : null;
    const after = nextI < edges ? grid[nextI][j] : null;
    if (!before || !before.seen) { if (before || ring[i][1] > 1e-6) f.lines.push(seg(c0, c3)); }
    else if (sharpAt(i) && before.depth <= f.depth) f.lines.push(seg(c0, c3));
    if (!after || !after.seen) { if (after || ring[(i + 1) % ring.length][1] > 1e-6) f.lines.push(seg(c1, c2)); }
    else if (sharpAt((i + 1) % ring.length) && after.depth < f.depth) f.lines.push(seg(c1, c2));
    // meridian sides: angle j (c0-c1) and j+1 (c3-c2); the cut planes are drawn by the section
    if (j > 0 && !grid[i][j - 1]?.seen) f.lines.push(seg(c0, c1));
    if (j < steps - 1 && !grid[i][j + 1]?.seen) f.lines.push(seg(c3, c2));
  }
  facets.sort((a, b) => a.depth - b.depth);
  // the two cut faces lie in one plane; their normal points at the half that was removed
  const cut = (angle) => ring.map(([s, r]) => at(F, s, r, angle));
  let sections;
  if (axis) sections = [[...cut(from), ...cut(to).reverse()]];
  else sections = [cut(from), cut(to)];
  // outward normals of the two cut faces: -tangent at `from`, +tangent at `to`
  const tangent = (angle) => add3(mul3(F.u, -Math.sin(angle)), mul3(F.v, Math.cos(angle)));
  const cutNormals = [mul3(tangent(from), -1), tangent(to)];
  const cutSeen = cutNormals.map((n) => dot3(n, V) > 1e-6);
  const cutTones = cutNormals.map((n) => bandOf(dot3(unit3(n), L)));
  const depth = facets.length ? facets.reduce((sum, f) => sum + f.depth, 0) / facets.length : 0;
  return { facets, sections, cutSeen, cutTones, axis, depth, section };
}

// Paint one sectioned part: facets back to front with their own edges, then the cut faces.
export function turnSvg(part, P, { edge = "mid", cls = "", sectionCls = "cam-section", sections = true } = {}) {
  const out = [];
  for (const f of part.facets) {
    const d = pathOf(f.corners.map((p) => iso(p, P)), true);
    out.push(`<path ${toneClass(f.tone)} d="${d}"/>`);
    if (f.lines.length) out.push(`<path class="iso-line" data-tone="${edge}" d="${f.lines.join("")}"/>`);
  }
  if (sections) out.push(sectionSvg(part, P, { edge, sectionCls }));
  return `<g class="iso-solid cam-turn${cls ? " " + cls : ""}" data-seamless="">${out.join("")}</g>`;
}

export function sectionSvg(part, P, { edge = "hi", sectionCls = "cam-section" } = {}) {
  return part.sections
    .filter((_, index) => (part.axis ? part.cutSeen[0] : part.cutSeen[index]))
    .map((poly) => {
      const d = pathOf(poly.map((p) => iso(p, P)), true);
      return `<path class="iso-fill ${sectionCls}" d="${d}"/><path class="iso-line" data-tone="${edge}" d="${d}"/>`;
    })
    .join("");
}

// Lens element: centre thickness t, half-aperture a, surface curvatures c1 (front, +s side) and c2 (back).
// Positive c1 bulges toward +s, positive c2 bulges toward -s (biconvex when both positive).
const sag = (c, r) => (Math.abs(c) < 1e-9 ? 0 : (c * r * r) / (1 + Math.sqrt(Math.max(0, 1 - c * c * r * r))));
export function elementProfile(sc, t, a, c1, c2, n = 6) {
  const front = [];
  const back = [];
  for (let k = 0; k <= n; k++) {
    const r = (a * k) / n;
    front.push([sc + t / 2 - sag(c1, r), r, k > 0 && k < n ? 1 : 0]);
    back.push([sc - t / 2 + sag(c2, r), r, k > 0 && k < n ? 1 : 0]);
  }
  return [...front, ...back.reverse()];
}
export const elementEdge = (sc, t, a, c1, c2) => [sc + t / 2 - sag(c1, a), sc - t / 2 + sag(c2, a)];

// The 2D matrix that maps local (X, Y) on a plane through o with unit axes ex, ey to the screen.
export function planeMatrix(o, ex, ey, P) {
  const O = iso(o, P);
  const X = iso(add3(o, ex), P);
  const Y = iso(add3(o, ey), P);
  const f = (v) => Math.round(v * 1000) / 1000;
  return `matrix(${f(X[0] - O[0])} ${f(X[1] - O[1])} ${f(Y[0] - O[0])} ${f(Y[1] - O[1])} ${f(O[0])} ${f(O[1])})`;
}

export { TAU };
