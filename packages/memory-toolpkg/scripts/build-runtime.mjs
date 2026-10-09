import { readdirSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
execFileSync(process.execPath, [join(root, "scripts/check-runtime.mjs")], { stdio: "inherit" });
rmSync(join(root, "dist"), { recursive: true, force: true });
function copy(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copy(join(source, entry.name), join(target, entry.name));
    else if (entry.name.endsWith(".js")) copyFileSync(join(source, entry.name), join(target, entry.name));
  }
}
copy(join(root, "src"), join(root, "dist"));
execFileSync(process.execPath, [join(root, "scripts/copy-core.mjs")], { stdio: "inherit" });
