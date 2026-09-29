import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export default function globalSetup(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  execFileSync(process.execPath, [join(root, "scripts/build.mjs")], { stdio: "inherit" });
}
