import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { PNG } from "pngjs";

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("R19 acceptance project requires an absolute output path.");
const source = path.resolve("examples/starter.tdproj");
fs.cpSync(source, output, { recursive: true, errorOnExist: true });

const manifestPath = path.join(output, "project.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.schemaVersion = 5;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const icon = new PNG({ width: 1024, height: 1024 });
for (let index = 0; index < icon.data.length; index += 4) {
  icon.data[index] = 33;
  icon.data[index + 1] = 78;
  icon.data[index + 2] = 102;
  icon.data[index + 3] = 255;
}
fs.mkdirSync(path.join(output, "assets"), { recursive: true });
fs.writeFileSync(path.join(output, "assets", "app-icon.png"), PNG.sync.write(icon));

fs.writeFileSync(path.join(output, "build-targets.json"), `${JSON.stringify({
  schemaVersion: 2,
  defaults: { desktop: "native-acceptance" },
  targets: {
    "native-acceptance": {
      id: "native-acceptance",
      platform: "desktop",
      renderer: "canvas",
      appId: "local.towerforge.r19acceptance",
      appName: "R19 Generated Acceptance",
      appVersion: "0.1.0",
      formFactor: "desktop",
      viewport: { fit: "contain", padding: 24, minZoom: 0.5, maxZoom: 3, initialZoom: 1 },
      quality: "balanced",
      locale: "auto",
      inputProfile: "keyboard_mouse",
      window: { width: 1280, height: 720, minWidth: 1024, minHeight: 720, fullscreen: false, resizable: true },
      bundle: { iconSource: "assets/app-icon.png", targets: ["dmg", "nsis", "msi", "appimage", "deb", "rpm"] },
      updater: { enabled: false }
    }
  }
}, null, 2)}\n`);
