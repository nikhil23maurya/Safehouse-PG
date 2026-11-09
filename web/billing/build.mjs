const { build } = await import("esbuild").catch(
  () => import("../../mobile/frontend/node_modules/esbuild/lib/main.js"),
);
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
const out = new URL("./dist/", import.meta.url),
  source = new URL("../../mobile/frontend/src/", import.meta.url);
await mkdir(out, { recursive: true });
await build({
  entryPoints: [
    new URL("./app.js", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
  ],
  outfile: new URL("billing.js", out).pathname.replace(/^\/(\w:)/, "$1"),
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  external: ["https://*"],
});
await copyFile(
  new URL("index.html", import.meta.url),
  new URL("index.html", out),
);
await writeFile(
  new URL("billing.css", out),
  (
    await Promise.all(
      ["tokens", "components", "platform"].map((n) =>
        readFile(new URL(`styles/${n}.css`, source), "utf8"),
      ),
    )
  ).join("\n") +
    (await readFile(new URL("styles.css", import.meta.url), "utf8")),
);
for (const name of [
  "InterVariable.woff2",
  "ManropeVariable.ttf",
  "Manrope-OFL.txt",
])
  await copyFile(new URL(`assets/fonts/${name}`, source), new URL(name, out));
await copyFile(
  new URL("assets/fonts/OFL.txt", source),
  new URL("Inter-OFL.txt", out),
);
await copyFile(
  new URL("assets/onboarding/payments.webp", source),
  new URL("onboarding-payments.webp", out),
);
console.log(
  "Built separate PGOne web billing surface; no Android bundle or deployment changed.",
);
