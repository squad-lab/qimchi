// Export the editable SVG to the PNG sizes Finder needs and a design preview.
// Run after npm ci in frontend: node scripts/render_dmg_artwork.mjs
// Optional first argument: alternate preview filename if the default is open.
import { readFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const assets = new URL("../packaging/assets/", import.meta.url);
const source = await readFile(new URL("dmg-background.svg", assets), "utf8");
const iconSource = await readFile(
  new URL("qimchi-macos-icon.svg", assets),
  "utf8",
);
const browser = await chromium.launch();
try {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({
      viewport: { width: 800, height: 420 },
      deviceScaleFactor: scale,
    });
    await page.setContent(
      `<style>body{margin:0}svg{display:block}</style>${source}`,
    );
    await page.screenshot({
      path: fileURLToPath(
        new URL(`dmg-background${scale === 2 ? "@2x" : ""}.png`, assets),
      ),
    });
    await page.close();
  }

  // Export a crisp icon source for macOS iconutil (never upscale the 96px logo).
  const iconPage = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
  });
  await iconPage.setContent(
    `<style>body{margin:0}svg{display:block}</style>${iconSource}`,
  );
  await iconPage.screenshot({
    path: fileURLToPath(new URL("qimchi-macos-icon.png", assets)),
    omitBackground: true,
  });
  await iconPage.close();

  // Illustrative overlay only. Finder supplies the actual icons and labels.
  const logo = await readFile(new URL("qimchi-macos-icon.png", assets));
  const overlay = `
    <defs>
      <linearGradient id="folder" x2="0" y2="1">
        <stop stop-color="#72d2f6"/><stop offset="1" stop-color="#35a7d9"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
        <feDropShadow dy="3" stdDeviation="3" flood-color="#50616c" flood-opacity=".2"/>
      </filter>
    </defs>
    <g filter="url(#shadow)" transform="translate(0 -60)">
      <image x="136" y="196" width="128" height="128" href="data:image/png;base64,${logo.toString("base64")}"/>
      <path d="M536 216 Q536 205 547 205 H574 L588 216 H653 Q664 216 664 227 V312 Q664 320 656 320 H544 Q536 320 536 312 Z" fill="#45b5e4"/>
      <rect x="541" y="226" width="118" height="82" rx="4" fill="#f8fdff"/>
      <rect x="536" y="234" width="128" height="86" rx="9" fill="url(#folder)"/>
      <path d="M582 299 L604 257 M615 299 L593 257 M577 284 H620" fill="none" stroke="#2787ad" stroke-width="6" stroke-linecap="round" opacity=".6"/>
    </g>
    <g font-family="Segoe UI, Helvetica Neue, Arial, sans-serif" font-size="16" text-anchor="middle" fill="#263c43">
      <text x="200" y="291">Qimchi</text>
      <text x="600" y="291">Applications</text>
    </g>`;
  const previewDir = new URL("../packaging/build/", import.meta.url);
  await mkdir(previewDir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 800, height: 420 },
    deviceScaleFactor: 2,
  });
  await page.setContent(
    `<style>body{margin:0}svg{display:block}</style>${source.replace("</svg>", `${overlay}</svg>`)}`,
  );
  await page.screenshot({
    path: fileURLToPath(
      new URL(process.argv[2] || "dmg-design-preview.png", previewDir),
    ),
  });
  console.log(
    `Exported DMG background (1x/2x), macOS icon and packaging/build/${process.argv[2] || "dmg-design-preview.png"}`,
  );
} finally {
  await browser.close();
}
