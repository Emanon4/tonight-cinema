// Brand mark geometry, shared by the site header and the generated icons.
// "月相胶片": a strip of film whose frames show the moon waxing; the square
// icon keeps a single frame with a crescent.
export const BRAND = { ink: "#f5f3ef", amber: "#f3b660", night: "#06080b" };

const f = (n) => Math.round(n * 100) / 100;
const circle = (cx, cy, r) =>
  `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
const rect = (x, y, w, h, rx) =>
  `M${f(x + rx)} ${f(y)}h${f(w - 2 * rx)}a${f(rx)} ${f(rx)} 0 0 1 ${f(rx)} ${f(rx)}v${f(h - 2 * rx)}a${f(rx)} ${f(rx)} 0 0 1 ${f(-rx)} ${f(rx)}h${f(-(w - 2 * rx))}a${f(rx)} ${f(rx)} 0 0 1 ${f(-rx)} ${f(-rx)}v${f(-(h - 2 * rx))}a${f(rx)} ${f(rx)} 0 0 1 ${f(rx)} ${f(-rx)}Z`;

// A crescent as one closed path: the lit outer arc, then the shadow arc back.
export function crescentPath(cx, cy, r) {
  const ox = cx + 0.42 * r, oy = cy - 0.3 * r, or = 0.8 * r;
  const d = Math.hypot(ox - cx, oy - cy);
  const a = (r * r - or * or + d * d) / (2 * d);
  const h = Math.sqrt(r * r - a * a);
  const px = cx + (a * (ox - cx)) / d, py = cy + (a * (oy - cy)) / d;
  const nx = -(oy - cy) / d, ny = (ox - cx) / d;
  const [x1, y1, x2, y2] = [px + h * nx, py + h * ny, px - h * nx, py - h * ny];
  return `M${f(x1)} ${f(y1)}A${f(r)} ${f(r)} 0 1 1 ${f(x2)} ${f(y2)}A${f(or)} ${f(or)} 0 0 0 ${f(x1)} ${f(y1)}Z`;
}

// Horizontal strip, viewBox 0 0 64 40: three frames, moon waxing left to right.
export function stripSvg({ ink = BRAND.ink, moon = BRAND.amber } = {}) {
  let body = rect(0, 0, 64, 40, 4);
  for (let i = 0; i < 7; i++) body += rect(3.5 + i * 8.5, 3, 4, 3, 0.8) + rect(3.5 + i * 8.5, 34, 4, 3, 0.8);
  for (let i = 0; i < 3; i++) body += rect(3 + i * 20, 9, 18, 22, 1.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 40" aria-hidden="true">
  <path fill="${ink}" fill-rule="evenodd" d="${body}"/>
  <path fill="${moon}" d="${crescentPath(12, 20, 5.5)}"/>
  <path fill="${moon}" d="M32 14.5a5.5 5.5 0 0 1 0 11Z"/>
  <path fill="none" stroke="${moon}" stroke-width=".8" opacity=".5" d="${circle(32, 20, 5.5)}"/>
  <path fill="${moon}" d="${circle(52, 20, 5.5)}"/>
</svg>`;
}

// Single frame inside a 64x64 box (used for app icons and favicons).
function framePaths() {
  let body = rect(10, 9, 44, 46, 5);
  for (let i = 0; i < 4; i++) body += rect(15 + i * 9.5, 12.5, 4.5, 3.5, 0.9) + rect(15 + i * 9.5, 48, 4.5, 3.5, 0.9);
  body += rect(14, 19, 36, 26, 2);
  return { body, moon: crescentPath(32, 32, 9.5) };
}

export function iconSvg({ background = BRAND.night, ink = BRAND.ink, moon = BRAND.amber, radius = 14 } = {}) {
  const { body, moon: m } = framePaths();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${radius}" fill="${background}"/>
  <path fill="${ink}" fill-rule="evenodd" d="${body}"/>
  <path fill="${moon}" d="${m}"/>
</svg>
`;
}

// Safari pinned tabs take a single-colour silhouette.
export function pinnedSvg() {
  const { body, moon } = framePaths();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path fill="#000" fill-rule="evenodd" d="${body}"/>
  <path fill="#000" d="${moon}"/>
</svg>
`;
}
