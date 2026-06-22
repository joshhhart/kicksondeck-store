// Minimal static server for local preview (clean URLs -> /index.html).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PORT = process.env.PORT || 5050;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let fp = path.join(ROOT, p);
  try {
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
    if (!fs.existsSync(fp)) { const alt = path.join(ROOT, p, "index.html"); if (fs.existsSync(alt)) fp = alt; }
    if (!fs.existsSync(fp)) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end(fs.readFileSync(path.join(ROOT, "404.html"))); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream" });
    res.end(fs.readFileSync(fp));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
