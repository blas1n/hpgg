// Minimal static server with GitHub Pages semantics for the e2e suite: /dir/ → dir/index.html,
// /dir → 301 /dir/, missing → 404.html with status 404. Usage: node scripts/serve.mjs <root> <port>
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 4173);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain", ".woff2": "font/woff2" };

const send = (res, status, file) => {
  res.writeHead(status, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, rel);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { location: url.pathname + "/" + url.search });
      return res.end();
    }
    file = join(file, "index.html");
  }
  if (existsSync(file) && statSync(file).isFile()) return send(res, 200, file);
  send(res, 404, join(root, "404.html"));
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));
