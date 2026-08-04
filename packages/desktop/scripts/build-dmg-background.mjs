#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../../..");
const mark = await readFile(path.join(repoRoot, "assets/brand/towerforge-mark.svg"));
const markUrl = `data:image/svg+xml;base64,${mark.toString("base64")}`;
const outputPath = path.join(repoRoot, "packages/desktop/src-tauri/dmg-background.png");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 660, height: 420 },
    deviceScaleFactor: 1
  });
  await page.setContent(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        color: #e8e8e8;
        background:
          radial-gradient(circle at 50% 59%, rgba(126, 184, 126, .11), transparent 29%),
          radial-gradient(circle at 12% 0%, rgba(110, 168, 216, .07), transparent 31%),
          linear-gradient(145deg, #111311 0%, #171b18 52%, #101210 100%);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .grid {
        position: absolute; inset: 0; opacity: .34;
        background-image:
          linear-gradient(rgba(126, 184, 126, .055) 1px, transparent 1px),
          linear-gradient(90deg, rgba(126, 184, 126, .055) 1px, transparent 1px);
        background-size: 30px 30px;
        mask-image: linear-gradient(to bottom, rgba(0,0,0,.7), transparent 88%);
      }
      .frame { position: absolute; inset: 18px; border: 1px solid rgba(126,184,126,.16); border-radius: 15px; }
      .brand { position: absolute; top: 31px; left: 0; right: 0; display: flex; justify-content: center; align-items: center; gap: 11px; }
      .brand img { width: 35px; height: 35px; filter: drop-shadow(0 4px 12px rgba(0,0,0,.35)); }
      .name { font-size: 22px; line-height: 1; font-weight: 720; letter-spacing: -.35px; }
      .edition { margin-top: 5px; color: #7eb87e; font-size: 9px; line-height: 1; font-weight: 750; letter-spacing: 1.8px; text-transform: uppercase; }
      .copy { position: absolute; top: 112px; left: 0; right: 0; text-align: center; }
      .title { margin: 0; font-size: 17px; line-height: 1.25; font-weight: 620; letter-spacing: -.15px; }
      .subtitle { margin: 7px 0 0; color: #a3aaa4; font-size: 11px; line-height: 1.4; }
      .arrow {
        position: absolute; left: 278px; top: 253px; width: 102px; height: 3px; border-radius: 2px;
        background: linear-gradient(90deg, rgba(126,184,126,.22), #7eb87e);
        box-shadow: 0 0 18px rgba(126,184,126,.24);
      }
      .arrow::after {
        content: ""; position: absolute; right: -3px; top: 50%; width: 13px; height: 13px;
        border-top: 3px solid #7eb87e; border-right: 3px solid #7eb87e;
        transform: translateY(-50%) rotate(45deg); border-radius: 1px;
      }
      .arrow-label {
        position: absolute; top: 223px; left: 0; right: 0; color: #7eb87e;
        font-size: 9px; font-weight: 760; letter-spacing: 1.7px; text-align: center;
      }
      .hint {
        position: absolute; left: 0; right: 0; bottom: 27px; color: #737b74;
        font-size: 10px; letter-spacing: .15px; text-align: center;
      }
    </style></head><body>
      <div class="grid"></div><div class="frame"></div>
      <div class="brand">
        <img src="${markUrl}" alt="">
        <div><div class="name">TowerForge</div><div class="edition">Studio for macOS</div></div>
      </div>
      <div class="copy">
        <p class="title">Drag TowerForge to Applications</p>
        <p class="subtitle">One drag, then launch it from your Applications folder.</p>
      </div>
      <div class="arrow-label">DRAG TO INSTALL</div><div class="arrow"></div>
      <div class="hint">Local-first · Your projects stay on your Mac</div>
    </body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  await page.screenshot({ path: outputPath, type: "png" });
  process.stdout.write(`DMG background written to ${pathToFileURL(outputPath).href}\n`);
} finally {
  await browser.close();
}
