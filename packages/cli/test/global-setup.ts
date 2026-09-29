import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Build dist/stepsnap.js once so bin.test.ts can spawn the real binary. */
export default function setup() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync(process.execPath, ["scripts/build.mjs"], { cwd: root, stdio: "pipe" });
}
