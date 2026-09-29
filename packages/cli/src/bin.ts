import { run } from "./run.ts";

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e) => {
    process.stderr.write(`stepsnap: ${(e as Error)?.stack ?? e}\n`);
    process.exitCode = 1;
  },
);
