import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const assets = fileURLToPath(
  new URL("../app/src/main/assets/", import.meta.url),
);
const types = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
};
http
  .createServer(async (req, res) => {
    const name =
      req.url?.split("?")[0] === "/"
        ? "index.html"
        : req.url?.split("?")[0].slice(1);
    if (!["index.html", "app.js", "app.css", "InterVariable.woff2", "Inter-OFL.txt"].includes(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.writeHead(200, {
        "Content-Type": `${types[path.extname(name)]}; charset=utf-8`,
        "Cache-Control": "no-store",
      });
      res.end(await readFile(path.join(assets, name)));
    } catch {
      res.writeHead(404).end();
    }
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("SafeHouse preview: http://127.0.0.1:4173"),
  );
