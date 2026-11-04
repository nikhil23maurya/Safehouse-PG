import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../app/src/main/assets");
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: here,
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: path.join(out, "app.js"),
  format: "iife",
  target: ["chrome80"],
  minify: true,
  legalComments: "eof",
  metafile: true,
}).then(async (result) => {
  await writeFile(
    path.join(here, "build-meta.json"),
    JSON.stringify(result.metafile, null, 2),
  );
});
const css = await Promise.all(
  ["tokens", "components", "screens"].map((name) =>
    readFile(path.join(here, `src/styles/${name}.css`), "utf8"),
  ),
);
await writeFile(path.join(out, "app.css"), css.join("\n"));
await writeFile(
  path.join(out, "index.html"),
  await readFile(path.join(here, "index.html"), "utf8"),
);
console.log("Built maintained SafeHouse frontend → Android assets");
