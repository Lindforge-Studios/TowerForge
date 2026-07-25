import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fs.realpathSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "game"));
const portIndex = process.argv.indexOf("--port");
const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4173;
const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 4173;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };

function confinedFile(rawUrl) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(rawUrl || "/", "http://127.0.0.1").pathname); }
  catch { return null; }
  const requested = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
  const lexical = path.relative(ROOT, requested);
  if (lexical.startsWith("..") || path.isAbsolute(lexical)) return null;
  try {
    const candidate = fs.statSync(requested).isDirectory() ? path.join(requested, "index.html") : requested;
    const real = fs.realpathSync(candidate);
    const relative = path.relative(ROOT, real);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

const checkPathIndex = process.argv.indexOf("--check-path");
if (checkPathIndex >= 0) {
  process.stdout.write(confinedFile(process.argv[checkPathIndex + 1]) ? "allowed\n" : "blocked\n");
  process.exit(0);
}

const server = http.createServer((req, res) => {
  if (!['GET', 'HEAD'].includes(req.method || '')) { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
  const file = confinedFile(req.url);
  if (!file) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
  const headers = {
    "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
});
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  console.log("TowerForge game: http://127.0.0.1:" + address.port);
});
