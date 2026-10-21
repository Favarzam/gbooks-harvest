import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import api from "../api/index.js";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function safePath(urlPath) {
  const relative = decodeURIComponent(urlPath.split("?")[0]);
  const full = normalize(join(publicDir, relative === "/" ? "/index.html" : relative));
  if (!full.startsWith(publicDir)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    const path = req.url.split("?")[0];
    if (path === "/api" || path.startsWith("/api/")) {
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method,
        headers: req.headers,
      });
      const response = await api.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = safePath(path);
    if (!file) {
      res.writeHead(400);
      res.end("Bad path");
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(500);
    res.end("Server error");
    console.error(err);
  }
});

server.listen(port, () => {
  console.log(`gbooks-harvest local server: http://127.0.0.1:${port}`);
});
