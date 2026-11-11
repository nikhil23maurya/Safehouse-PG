import {dots} from "./src/components/loading.js";
import {brand} from "./src/components/brand.js";
import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../app/src/main/assets");
await mkdir(out, { recursive: true });
await copyFile(path.join(here, "src/assets/fonts/InterVariable.woff2"), path.join(out, "InterVariable.woff2"));
await copyFile(path.join(here, "src/assets/fonts/OFL.txt"), path.join(out, "Inter-OFL.txt"));
await copyFile(path.join(here, "src/assets/fonts/ManropeVariable.ttf"), path.join(out, "ManropeVariable.ttf"));
await copyFile(path.join(here, "src/assets/fonts/Manrope-OFL.txt"), path.join(out, "Manrope-OFL.txt"));
for (const name of ["residence","room","records","royal-residence"]) await copyFile(path.join(here, `src/assets/illustrations/${name}.webp`), path.join(out, `illustration-${name}.webp`));
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
  ["tokens", "components", "screens", "platform", "premium", "motion", "owner-payments", "royal-system", "product-ux"].map((name) =>
    readFile(path.join(here, `src/styles/${name}.css`), "utf8"),
  ),
);
await writeFile(path.join(out, "app.css"), css.join("\n"));
await writeFile(
  path.join(out, "index.html"),
  (await readFile(path.join(here, "index.html"), "utf8")).replace("{{PGONE_BOOT_BRAND}}",brand()+dots("Opening PGOne")),
);
console.log("Built maintained PGOne frontend → Android assets");
