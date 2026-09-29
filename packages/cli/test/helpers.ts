import { run } from "../src/run.ts";

export interface Ran {
  code: number;
  out: string;
  err: string;
}

/** Run the CLI in-process; replaces the sandbox path with <TMP> so output is stable. */
export async function cli(args: string[], cwd: string): Promise<Ran> {
  let out = "";
  let err = "";
  const code = await run(args, { cwd, stdout: (t) => void (out += t), stderr: (t) => void (err += t) });
  const norm = (s: string) => s.split(cwd).join("<TMP>");
  return { code, out: norm(out), err: norm(err) };
}

export const json = (r: Ran): any => JSON.parse(r.out);
