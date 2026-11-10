// Builds the extension into dist/ (load it in chrome://extensions → Load unpacked).
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const common = { bundle: true, target: "chrome120", minify: true, sourcemap: false, legalComments: "none", logLevel: "warning" };
await build({ ...common, entryPoints: ["src/background.ts"], outfile: `${out}/background.js`, format: "esm" });
await build({ ...common, entryPoints: ["src/content.ts"], outfile: `${out}/content.js`, format: "iife" });
await build({ ...common, entryPoints: ["src/popup.ts"], outfile: `${out}/popup.js`, format: "iife" });

copyFileSync("static/manifest.json", `${out}/manifest.json`);
copyFileSync("static/popup.html", `${out}/popup.html`);

// Icons: a ring in Orbit's accent color, drawn here so no image files are needed.
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function icon(size) {
  const rows = [];
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center) / (size / 2);
      const ring = d > 0.56 && d < 0.92;
      const planet = Math.hypot(x - size * 0.74, y - size * 0.26) / (size / 2) < 0.17;
      const disc = d <= 0.56;
      if (planet) row.push(236, 236, 242, 255);
      else if (ring) row.push(140, 126, 255, 255);
      else if (disc) row.push(35, 30, 74, 255);
      else row.push(0, 0, 0, 0);
    }
    rows.push(Buffer.from(row));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (const size of [16, 32, 48, 128]) writeFileSync(`${out}/icon-${size}.png`, icon(size));

console.log("Built apps/extension/dist");
