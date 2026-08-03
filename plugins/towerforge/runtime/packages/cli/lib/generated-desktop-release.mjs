export function generatedUpdaterEntryScript() {
  return `import fs from "node:fs";
import path from "node:path";

const [root, platformFamily, runnerArch, baseUrl, outputDir] = process.argv.slice(2);
if (!root || !platformFamily || !runnerArch || !baseUrl || !outputDir) throw new Error("Updater entry arguments are incomplete.");
const architecture = ({ X64: "x86_64", ARM64: "aarch64" })[runnerArch.toUpperCase()];
const supportedArchitectures = platformFamily === "darwin"
  ? new Set(["x86_64", "aarch64"])
  : new Set(["x86_64"]);
if (!["darwin", "windows", "linux"].includes(platformFamily) || !architecture || !supportedArchitectures.has(architecture)) {
  throw new Error("Updater platform family/runner architecture is unsupported.");
}
const platform = platformFamily + "-" + architecture;
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) files.push(file);
  }
}
walk(root);
const signatures = files.filter((file) => file.endsWith(".sig") && fs.existsSync(file.slice(0, -4))).sort();
if (signatures.length !== 1) throw new Error("Expected exactly one updater payload/signature pair for " + platform + ".");
const signatureFile = signatures[0];
const payloadFile = signatureFile.slice(0, -4);
const signature = fs.readFileSync(signatureFile, "utf8").trim();
if (!signature || signature.length > 32768) throw new Error("Updater signature is empty or oversized.");
fs.mkdirSync(outputDir, { recursive: true });
for (const file of [payloadFile, signatureFile]) fs.copyFileSync(file, path.join(outputDir, path.basename(file)));
const payload = path.basename(payloadFile);
const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
const url = normalizedBaseUrl + "/" + encodeURIComponent(payload);
fs.writeFileSync(path.join(outputDir, "updater-entry-" + platform + ".json"), JSON.stringify({ platform, payload, signature, url }, null, 2) + "\\n");
`;
}

export function generatedSigningStatusScript() {
  return `import fs from "node:fs";

const name = process.argv[2];
if (!name || !/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error("Signing status name is invalid.");
const required = process.env.RUNNER_OS === "macOS" || process.env.RUNNER_OS === "Windows";
const status = required ? (process.env.TOWERFORGE_PLATFORM_SIGNED === "true" ? "signed" : "unsigned") : "not-required";
fs.writeFileSync("signing-status-" + name + ".txt", status + "\\n");
`;
}

export function generatedReleaseAssemblerScript(updaterActive = false) {
  return `import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [artifactsDir, releaseDir, version, commitUrl, tagUrl, policyOutput] = process.argv.slice(2);
if (!artifactsDir || !releaseDir || !version || !commitUrl || !tagUrl || !policyOutput) throw new Error("Release assembler arguments are incomplete.");
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile()) files.push(file);
  }
}
walk(artifactsDir);
const installerPattern = /(?:\\.dmg|\\.exe|\\.msi|\\.AppImage|\\.deb|\\.rpm)$/;
const installers = files.filter((file) => installerPattern.test(file)).sort();
if (installers.length !== 6) throw new Error("Expected exactly six desktop installers, received " + installers.length + ".");
fs.mkdirSync(releaseDir, { recursive: true });
for (const installer of installers) fs.copyFileSync(installer, path.join(releaseDir, path.basename(installer)));

${updaterActive ? `const entryFiles = files.filter((file) => /updater-entry-(?:darwin-(?:aarch64|x86_64)|windows-x86_64|linux-x86_64)\\.json$/.test(file)).sort();
if (entryFiles.length !== 3) throw new Error("Expected exactly three updater metadata entries.");
const platforms = {};
for (const entryFile of entryFiles) {
  const entry = JSON.parse(fs.readFileSync(entryFile, "utf8"));
  if (!entry || typeof entry.platform !== "string" || typeof entry.payload !== "string" || typeof entry.signature !== "string" || typeof entry.url !== "string") {
    throw new Error("Updater metadata entry is malformed.");
  }
  const payload = files.find((file) => path.basename(file) === entry.payload);
  const signature = files.find((file) => path.basename(file) === entry.payload + ".sig");
  if (!payload || !signature) throw new Error("Updater payload/signature pair is incomplete for " + entry.platform + ".");
  fs.copyFileSync(payload, path.join(releaseDir, path.basename(payload)));
  fs.copyFileSync(signature, path.join(releaseDir, path.basename(signature)));
  platforms[entry.platform] = { signature: entry.signature, url: entry.url };
}
fs.writeFileSync(path.join(releaseDir, "latest.json"), JSON.stringify({ version, platforms }, null, 2) + "\\n");
` : ""}
const status = new Map(files.filter((file) => /signing-status-(?:dmg|exe|msi)\\.txt$/.test(file)).map((file) => [path.basename(file), fs.readFileSync(file, "utf8").trim()]));
const signed = status.get("signing-status-dmg.txt") === "signed"
  && status.get("signing-status-exe.txt") === "signed"
  && status.get("signing-status-msi.txt") === "signed";
const assets = fs.readdirSync(releaseDir).filter((name) => name !== "SHA256SUMS" && name !== "RELEASE_NOTES.md").sort();
const sums = assets.map((name) => createHash("sha256").update(fs.readFileSync(path.join(releaseDir, name))).digest("hex") + "  " + name).join("\\n") + "\\n";
fs.writeFileSync(path.join(releaseDir, "SHA256SUMS"), sums);
const label = signed ? "Signed build" : "Unsigned build";
fs.writeFileSync(path.join(releaseDir, "RELEASE_NOTES.md"), "# " + label + "\\n\\nBuilt from exact commit [source](" + commitUrl + ").\\n\\nTag/source: [tag](" + tagUrl + ").\\n\\n## SHA-256\\n\\n~~~\\n" + sums + "~~~\\n");
fs.appendFileSync(policyOutput, "signed=" + String(signed) + "\\n");
`;
}

export function generatedDesktopReleaseWorkflow(updaterActive = false) {
  const updaterEnv = updaterActive ? `
      TAURI_SIGNING_PRIVATE_KEY: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}` : "";
  const updaterMatrix = updaterActive ? `
            updater: true
            updaterFamily: darwin` : "";
  const updaterWindows = updaterActive ? `
            updater: true
            updaterFamily: windows` : "";
  const updaterLinux = updaterActive ? `
            updater: true
            updaterFamily: linux` : "";
  const updaterFalse = updaterActive ? `
            updater: false` : "";
  const updaterStage = updaterActive ? `
      - name: Stage updater payload, .sig and latest.json metadata entry
        if: matrix.updater == true
        run: node scripts/collect-updater-entry.mjs src-tauri/target "\${{ matrix.updaterFamily }}" "\${{ runner.arch }}" "\${{ github.server_url }}/\${{ github.repository }}/releases/download/\${{ github.ref_name }}" updater-release
        # Payloads are .app.tar.gz, .AppImage.tar.gz or .nsis.zip with adjacent .sig signatures.
        # The assembler writes latest.json { version, platforms: { target: { signature, url } } }.
` : "";
  const updaterUpload = updaterActive ? `
            updater-release/*` : "";
  return `name: Generated TowerForge Desktop Release

on:
  workflow_dispatch:
  push:
    tags: ["v*"]

permissions:
  contents: read

jobs:
  installers:
    env:
      APPLE_CERTIFICATE: \${{ secrets.APPLE_CERTIFICATE }}
      APPLE_CERTIFICATE_PASSWORD: \${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      APPLE_SIGNING_IDENTITY: \${{ secrets.APPLE_SIGNING_IDENTITY }}
      APPLE_ID: \${{ secrets.APPLE_ID }}
      APPLE_PASSWORD: \${{ secrets.APPLE_PASSWORD }}
      APPLE_TEAM_ID: \${{ secrets.APPLE_TEAM_ID }}
      WINDOWS_CERTIFICATE: \${{ secrets.WINDOWS_CERTIFICATE }}
      WINDOWS_CERTIFICATE_PASSWORD: \${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}${updaterEnv}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            name: dmg
            format: dmg
            bundles: dmg
            extension: .dmg${updaterMatrix}
          - os: windows-latest
            name: exe
            format: exe
            bundles: nsis
            extension: .exe${updaterWindows}
          - os: windows-latest
            name: msi
            format: msi
            bundles: msi
            extension: .msi${updaterFalse}
          - os: ubuntu-22.04
            name: AppImage
            format: AppImage
            bundles: appimage
            extension: .AppImage${updaterLinux}
          - os: ubuntu-22.04
            name: deb
            format: deb
            bundles: deb
            extension: .deb${updaterFalse}
          - os: ubuntu-22.04
            name: rpm
            format: rpm
            bundles: rpm
            extension: .rpm${updaterFalse}
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          ref: \${{ github.sha }}
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: "22.14.0"
      - name: Install pinned Rust toolchain
        run: |
          rustup toolchain install 1.88.0 --profile minimal
          rustup default 1.88.0
      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: sudo apt-get update && sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
      - name: Import Apple signing identity for signing and notarization
        if: runner.os == 'macOS' && env.APPLE_CERTIFICATE != '' && env.APPLE_CERTIFICATE_PASSWORD != '' && env.APPLE_SIGNING_IDENTITY != '' && env.APPLE_ID != '' && env.APPLE_PASSWORD != '' && env.APPLE_TEAM_ID != ''
        shell: bash
        run: |
          certificate="$RUNNER_TEMP/towerforge-certificate.p12"
          keychain="$RUNNER_TEMP/towerforge-signing.keychain-db"
          printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$certificate"
          security create-keychain -p "$APPLE_CERTIFICATE_PASSWORD" "$keychain"
          security set-keychain-settings -lut 21600 "$keychain"
          security unlock-keychain -p "$APPLE_CERTIFICATE_PASSWORD" "$keychain"
          security import "$certificate" -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$keychain"
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$APPLE_CERTIFICATE_PASSWORD" "$keychain"
          security list-keychain -d user -s "$keychain"
      - name: Import Windows signing certificate
        if: runner.os == 'Windows' && env.WINDOWS_CERTIFICATE != '' && env.WINDOWS_CERTIFICATE_PASSWORD != ''
        shell: pwsh
        run: |
          $certificatePath = Join-Path $env:RUNNER_TEMP 'towerforge-certificate.pfx'
          [IO.File]::WriteAllBytes($certificatePath, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
          $password = ConvertTo-SecureString -String $env:WINDOWS_CERTIFICATE_PASSWORD -Force -AsPlainText
          $certificate = Import-PfxCertificate -FilePath $certificatePath -CertStoreLocation Cert:\\CurrentUser\\My -Password $password
          $configPath = Join-Path $PWD 'src-tauri/tauri.conf.json'
          $config = Get-Content $configPath -Raw | ConvertFrom-Json
          $windows = [ordered]@{ certificateThumbprint = $certificate.Thumbprint; digestAlgorithm = 'sha256'; timestampUrl = 'http://timestamp.digicert.com' }
          $config.bundle | Add-Member -NotePropertyName windows -NotePropertyValue $windows -Force
          $config | ConvertTo-Json -Depth 100 | Set-Content $configPath -Encoding utf8
          "TOWERFORGE_WINDOWS_THUMBPRINT=$($certificate.Thumbprint)" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
      - run: npm install --ignore-scripts --no-package-lock
      - name: Build \${{ matrix.format }} installer
        run: npx tauri build --bundles "\${{ matrix.bundles }}"
      - name: Verify macOS application signature and notarization ticket
        if: runner.os == 'macOS' && env.APPLE_CERTIFICATE != '' && env.APPLE_CERTIFICATE_PASSWORD != '' && env.APPLE_SIGNING_IDENTITY != '' && env.APPLE_ID != '' && env.APPLE_PASSWORD != '' && env.APPLE_TEAM_ID != ''
        shell: bash
        run: |
          dmg="$(find src-tauri/target -type f -name '*.dmg' -print -quit)"
          mount="$RUNNER_TEMP/towerforge-signature-check"
          test -n "$dmg"
          mkdir -p "$mount"
          hdiutil attach -readonly -nobrowse -mountpoint "$mount" "$dmg"
          trap 'hdiutil detach "$mount"' EXIT
          app=""
          for candidate in "$mount"/*.app; do
            if [ -d "$candidate" ]; then app="$candidate"; break; fi
          done
          test -n "$app"
          codesign --verify --deep --strict --verbose=2 "$app"
          xcrun stapler validate "$app"
          echo 'TOWERFORGE_PLATFORM_SIGNED=true' >> "$GITHUB_ENV"
      - name: Verify Windows Authenticode signature
        if: runner.os == 'Windows' && env.WINDOWS_CERTIFICATE != '' && env.WINDOWS_CERTIFICATE_PASSWORD != ''
        shell: pwsh
        run: |
          $installers = @(Get-ChildItem src-tauri/target -Recurse -File | Where-Object { $_.Extension -eq '\${{ matrix.extension }}' })
          if ($installers.Count -ne 1) { throw "Expected exactly one Windows installer for signature verification." }
          $signature = Get-AuthenticodeSignature -FilePath $installers[0].FullName
          if ($signature.Status -ne 'Valid') { throw "Windows installer Authenticode signature is not valid." }
          if ($signature.SignerCertificate.Thumbprint -ne $env:TOWERFORGE_WINDOWS_THUMBPRINT) { throw "Windows installer signer does not match the imported certificate." }
          'TOWERFORGE_PLATFORM_SIGNED=true' | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
${updaterStage}      - name: Record signing policy evidence
        run: node scripts/write-signing-status.mjs "\${{ matrix.name }}"
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: installer-\${{ matrix.name }}
          if-no-files-found: error
          path: |
            src-tauri/target/**/bundle/**/*\${{ matrix.extension }}
            signing-status-\${{ matrix.name }}.txt${updaterUpload}

  assemble:
    needs: installers
    runs-on: ubuntu-latest
    outputs:
      signed: \${{ steps.assemble.outputs.signed }}
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          ref: \${{ github.sha }}
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          pattern: installer-*
          path: artifacts
          merge-multiple: true
      - name: Create SHA256SUMS and RELEASE_NOTES.md${updaterActive ? ", updater payloads, signatures and latest.json" : ""}
        id: assemble
        run: node scripts/assemble-release.mjs artifacts release "$(node -p 'require(\"./package.json\").version')" "\${{ github.server_url }}/\${{ github.repository }}/tree/\${{ github.sha }}" "\${{ github.server_url }}/\${{ github.repository }}/tree/\${{ github.ref_name }}" "$GITHUB_OUTPUT"
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: desktop-release-candidate
          path: release/*

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: assemble
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: desktop-release-candidate
          path: release
      - name: Publish signed build
        if: needs.assemble.outputs.signed == 'true'
        uses: softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65
        with:
          name: \${{ github.ref_name }}
          prerelease: false
          body_path: release/RELEASE_NOTES.md
          files: release/*
      - name: Publish Unsigned build
        if: needs.assemble.outputs.signed != 'true'
        uses: softprops/action-gh-release@3bb12739c298aeb8a4eeaf626c5b8d85266b0e65
        with:
          name: \${{ github.ref_name }} - Unsigned build
          prerelease: true
          body_path: release/RELEASE_NOTES.md
          files: release/*
`;
}
