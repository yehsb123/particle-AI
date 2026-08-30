import { buildSync } from "esbuild";
import { mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { join } from "node:path";

// NOTE: fs.cpSync({ recursive: true }) segfaults on Node 22.17 / Windows for this repo path,
// so static assets are copied file-by-file.
function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

mkdirSync("dist", { recursive: true });
copyDir("public", "dist");

buildSync({
  entryPoints: { background: "src/background.ts", content: "src/content.ts", options: "src/options.ts", sidepanel: "src/sidepanel.ts" },
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: "dist",
  sourcemap: false,
  logLevel: "info",
});

for (const f of ["manifest.json", "sidepanel.html", "options.html", "background.js", "content.js", "options.js", "sidepanel.js"]) {
  if (!existsSync(`dist/${f}`)) {
    console.error(`missing dist/${f}`);
    process.exit(1);
  }
}
console.log("extension built → apps/extension/dist");
