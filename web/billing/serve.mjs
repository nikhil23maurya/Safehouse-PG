import http from "node:http";
import { readFile } from "node:fs/promises";
const files = {
  "index.html": "text/html",
  "billing.js": "application/javascript",
  "billing.css": "text/css",
  "InterVariable.woff2": "font/woff2",
  "ManropeVariable.ttf": "font/ttf",
  "onboarding-payments.webp": "image/webp",
  "Manrope-OFL.txt": "text/plain",
  "Inter-OFL.txt": "text/plain",
};
http
  .createServer(async (req, res) => {
    const name = req.url === "/" ? "index.html" : req.url?.slice(1);
    if (!files[name]) return res.writeHead(404).end();
    try {
      const body = await readFile(new URL(`dist/${name}`, import.meta.url));
      res
        .writeHead(200, {
          "content-type": files[name],
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  })
  .listen(4174, "127.0.0.1", () =>
    console.log("PGOne separate web billing preview: http://127.0.0.1:4174"),
  );
