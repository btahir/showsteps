/** Stable process exit codes. Documented in README.md and AGENTS.md. */
export const EXIT = {
  ok: 0,
  /** The input exists but is not acceptable: invalid guide, unknown step id, bad steps file. */
  invalid: 1,
  /** Command line misuse: unknown command or option, missing argument, conflicting flags. */
  usage: 2,
  /** File system trouble: file missing, unreadable or unwritable. */
  io: 3,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Any failure the CLI or MCP server reports on purpose. Everything else is a bug. */
export class ShowstepsError extends Error {
  readonly exitCode: 1 | 2 | 3;
  /** Machine-readable detail lines (for example every schema violation). */
  readonly details: string[];
  constructor(exitCode: 1 | 2 | 3, message: string, details: string[] = []) {
    super(message);
    this.name = "ShowstepsError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

export const invalid = (message: string, details?: string[]) => new ShowstepsError(EXIT.invalid, message, details);
export const usage = (message: string) => new ShowstepsError(EXIT.usage, message);
export const ioError = (message: string) => new ShowstepsError(EXIT.io, message);
