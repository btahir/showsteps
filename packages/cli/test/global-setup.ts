import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Build dist/showsteps.js once so bin.test.ts can spawn the real binary. */
export default function setup() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const r = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed:\n${r.stderr.slice(0, 2000)}`);
}
