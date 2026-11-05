import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
const directory = new URL("../app/src/androidTest/assets/", import.meta.url);
await mkdir(directory, { recursive: true });
await build({
  entryPoints: [
    new URL(
      "test-support/native-fixtures.js",
      import.meta.url,
    ).pathname.replace(/^\/(\w:)/, "$1"),
  ],
  outfile: new URL("fixtures.js", directory).pathname.replace(/^\/(\w:)/, "$1"),
  bundle: true,
  format: "iife",
  target: "chrome80",
});
await copyFile(
  new URL("test-support/qr-fixture.png", import.meta.url),
  new URL("qr-fixture.png", directory),
);
console.log(
  "Prepared separate instrumentation fixtures (not shipped in app APK).",
);
