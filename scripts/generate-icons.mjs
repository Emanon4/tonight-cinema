import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { iconSvg, pinnedSvg } from "../src/brand.js";

// Writes the vector icons, then rasterizes PNG/ICO with a local headless Chrome
// and macOS `sips` (set CHROME to override the browser path).
const pub = path.resolve(import.meta.dirname, "../public");
fs.writeFileSync(path.join(pub, "favicon.svg"), iconSvg());
fs.writeFileSync(path.join(pub, "safari-pinned-tab.svg"), pinnedSvg());

const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));
const html = path.join(tmp, "icon.html"), big = path.join(tmp, "icon.png");
// iOS applies its own rounded mask, so the touch icon is a full square.
const render = (svg, out) => {
  fs.writeFileSync(html, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:512px;height:512px}</style>${svg}`);
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", "--window-size=512,512", `--screenshot=${out}`, `file://${html}`], { stdio: "ignore" });
};
const resize = (src, size, out) => execFileSync("sips", ["-z", String(size), String(size), src, "--out", out], { stdio: "ignore" });
render(iconSvg(), big);
resize(big, 32, path.join(pub, "favicon-32.png"));
const squareBig = path.join(tmp, "square.png");
render(iconSvg({ radius: 0 }), squareBig);
resize(squareBig, 180, path.join(pub, "apple-touch-icon.png"));

// ICO container holding PNG-encoded 16/32/48 images.
const sizes = [16, 32, 48].map((s) => { const out = path.join(tmp, `i${s}.png`); resize(big, s, out); return [s, fs.readFileSync(out)]; });
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach(([s, png], i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s, e); header.writeUInt8(s, e + 1); header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
fs.writeFileSync(path.join(pub, "favicon.ico"), Buffer.concat([header, ...sizes.map(([, png]) => png)]));
fs.rmSync(tmp, { recursive: true, force: true });
console.log("Icons written to public/");
