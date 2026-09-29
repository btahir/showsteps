import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cli, json } from "./helpers.ts";
import { PNG_SCREENSHOT, STEPS_INPUT, makeSandbox, type Sandbox } from "./fixture.ts";

let sb: Sandbox;
beforeAll(async () => {
  sb = await makeSandbox();
});
afterAll(() => rm(sb.dir, { recursive: true, force: true }));

const golden = (name: string) => `golden/${name}`;
const pretty = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}

describe("validate", () => {
  it("bundle, --json", async () => {
    const r = await cli(["validate", "guide.showsteps", "--json"], sb.dir);
    expect(r.code).toBe(0);
    await expect(pretty(json(r))).toMatchFileSnapshot(golden("validate.bundle.json"));
  });
  it("bare guide.json, text", async () => {
    const r = await cli(["validate", "bare/guide.json"], sb.dir);
    expect(r.code).toBe(0);
    await expect(r.out).toMatchFileSnapshot(golden("validate.text.txt"));
  });
  it("invalid guide: exit 1, one JSON object on stdout, message on stderr", async () => {
    const bad = join(sb.dir, "bad.json");
    await writeFile(bad, JSON.stringify({ schemaVersion: 1, id: "x", title: "", steps: "nope" }));
    const r = await cli(["validate", "bad.json", "--json"], sb.dir);
    expect(r.code).toBe(1);
    const j = json(r);
    expect(j.ok).toBe(false);
    expect(j.error.code).toBe("invalid");
    expect(j.error.errors.length).toBeGreaterThan(0);
    expect(r.err).toContain("invalid guide");
  });
  it("not JSON at all: exit 1", async () => {
    await writeFile(join(sb.dir, "junk.txt"), "hello");
    expect((await cli(["validate", "junk.txt"], sb.dir)).code).toBe(1);
  });
  it("missing file: exit 3", async () => {
    const r = await cli(["validate", "nope.showsteps", "--json"], sb.dir);
    expect(r.code).toBe(3);
    expect(json(r)).toMatchObject({ ok: false, error: { code: "io" } });
  });
});

describe("info and steps", () => {
  it("info --json", async () => {
    const r = await cli(["info", "guide.showsteps", "--json"], sb.dir);
    expect(r.code).toBe(0);
    await expect(pretty(json(r))).toMatchFileSnapshot(golden("info.json"));
  });
  it("info text", async () => {
    await expect((await cli(["info", "guide.showsteps"], sb.dir)).out).toMatchFileSnapshot(golden("info.txt"));
  });
  it("info never lists a masked value", async () => {
    const r = await cli(["steps", "guide.showsteps", "--json"], sb.dir);
    const s3 = json(r).steps.find((s: any) => s.id === "s3");
    expect(s3.action).toEqual({ type: "type", value: "•••", masked: true });
    expect(s3.sensitive).toBe(true);
  });
  it("steps --json", async () => {
    await expect(pretty(json(await cli(["steps", "guide.showsteps", "--json"], sb.dir)))).toMatchFileSnapshot(golden("steps.json"));
  });
  it("steps text", async () => {
    await expect((await cli(["steps", "bare/guide.json"], sb.dir)).out).toMatchFileSnapshot(golden("steps.txt"));
  });
});

describe("edit-step", () => {
  it("edits a copy with --out and leaves the source alone", async () => {
    const out = join(sb.dir, "edited.showsteps");
    const r = await cli(["edit-step", "guide.showsteps", "--id", "s2", "--title", "Enter your work email", "--description", "Use the address you signed up with.", "--skip", "--out", out, "--json"], sb.dir);
    expect(r.code).toBe(0);
    await expect(pretty(json(r))).toMatchFileSnapshot(golden("edit-step.json"));
    const after = json(await cli(["steps", out, "--json"], sb.dir)).steps.find((s: any) => s.id === "s2");
    expect(after).toMatchObject({ title: "Enter your work email", description: "Use the address you signed up with.", skipped: true });
    const before = json(await cli(["steps", "guide.showsteps", "--json"], sb.dir)).steps.find((s: any) => s.id === "s2");
    expect(before.skipped).toBe(false);
    // images survive the round trip
    const info = json(await cli(["info", out, "--json"], sb.dir));
    expect(info.screenshots.imagesFound).toBe(4);
  });
  it("edits in place and can unskip", async () => {
    const copy = join(sb.dir, "inplace.json");
    await writeFile(copy, await readFile(sb.json));
    expect((await cli(["edit-step", "inplace.json", "--id", "s6", "--unskip"], sb.dir)).code).toBe(0);
    const s6 = json(await cli(["steps", "inplace.json", "--json"], sb.dir)).steps.find((s: any) => s.id === "s6");
    expect(s6.skipped).toBe(false);
  });
  it("unknown id: exit 1", async () => {
    const r = await cli(["edit-step", "guide.showsteps", "--id", "nope", "--title", "x", "--out", join(sb.dir, "x.showsteps")], sb.dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no step with id "nope"');
  });
  it("usage errors: missing --id, nothing to change, --skip with --unskip", async () => {
    expect((await cli(["edit-step", "guide.showsteps", "--title", "x"], sb.dir)).code).toBe(2);
    expect((await cli(["edit-step", "guide.showsteps", "--id", "s1"], sb.dir)).code).toBe(2);
    expect((await cli(["edit-step", "guide.showsteps", "--id", "s1", "--skip", "--unskip"], sb.dir)).code).toBe(2);
  });
});

describe("regen-titles", () => {
  it("regenerates generated titles and keeps hand-edited ones", async () => {
    const out = join(sb.dir, "regen.showsteps");
    const r = await cli(["regen-titles", "guide.showsteps", "--out", out, "--json"], sb.dir);
    expect(r.code).toBe(0);
    await expect(pretty(json(r))).toMatchFileSnapshot(golden("regen-titles.json"));
    const steps = json(await cli(["steps", out, "--json"], sb.dir)).steps;
    expect(steps.find((s: any) => s.id === "s4").title).toBe("Click **Sign in**");
  });
});

describe("export", () => {
  it("--format all writes every format", async () => {
    const out = join(sb.dir, "export-all");
    const r = await cli(["export", "guide.showsteps", "--format", "all", "--out", out, "--json"], sb.dir);
    expect(r.code, r.err).toBe(0);
    const j = json(r);
    const reported: string[] = j.files.map((p: string) => p.replace("<TMP>", sb.dir));
    const rel = (await walk(out)).map((p) => relative(out, p));
    await expect(pretty({ files: rel, reported: reported.map((p) => relative(out, p)), skill: j.skill })).toMatchFileSnapshot(golden("export-all.json"));
    expect(new Set(reported)).toEqual(new Set(await walk(out)));
    expect((await readFile(join(out, "guide.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await readFile(join(out, "guide.docx"))).subarray(0, 2).toString()).toBe("PK");
    expect(await readFile(join(out, "guide.html"), "utf8")).toContain("Set up billing");
    expect(await readFile(join(out, "guide.md"), "utf8")).toContain("Set up billing");
  });
  it("skipped steps stay out of the exports; skill reports its name and folder", async () => {
    const out = join(sb.dir, "export-skill");
    const r = await cli(["export", "guide.showsteps", "--format", "skill", "--out", out, "--skill-name", "set-up-billing", "--json"], sb.dir);
    expect(r.code, r.err).toBe(0);
    expect(json(r).skill).toEqual({ name: "set-up-billing", dir: "<TMP>/export-skill/skill" });
    const skillMd = await readFile(join(out, "skill", "SKILL.md"), "utf8");
    expect(skillMd).toContain('name: "set-up-billing"');
    const steps = JSON.parse(await readFile(join(out, "skill", "steps.json"), "utf8"));
    expect(steps.steps.map((s: any) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    // the masked password never carries a value, only an env var name
    expect(steps.secrets).toHaveLength(1);
    expect(JSON.stringify(steps)).not.toContain("hunter2");
  });
  it("exported screenshots are re-rendered (redaction and highlight baked in), never the raw bytes", async () => {
    const out = join(sb.dir, "export-md");
    expect((await cli(["export", "guide.showsteps", "--format", "md", "--out", out], sb.dir)).code).toBe(0);
    const raw = PNG_SCREENSHOT;
    for (const id of ["s3", "s4"]) {
      const exported = new Uint8Array(await readFile(join(out, "images", `${id}.png`)));
      expect(Buffer.from(exported).equals(Buffer.from(raw)), id).toBe(false);
    }
  });
  it("--no-images leaves screenshots out of md and skill", async () => {
    const out = join(sb.dir, "export-noimg");
    expect((await cli(["export", "guide.showsteps", "--format", "md,skill", "--out", out, "--no-images"], sb.dir)).code).toBe(0);
    expect((await walk(out)).map((p) => relative(out, p))).toEqual(["guide.md", "skill/SKILL.md", "skill/replay.spec.ts", "skill/steps.json"]);
  });
  it("single format writes only that format; bare guide.json with images works", async () => {
    const out = join(sb.dir, "export-pw");
    const r = await cli(["export", "bare/guide.json", "--format", "playwright", "--out", out, "--json"], sb.dir);
    expect(r.code).toBe(0);
    expect((await walk(out)).map((p) => relative(out, p))).toEqual(["replay.spec.ts"]);
    const html = join(sb.dir, "export-bare-html");
    expect((await cli(["export", "bare/guide.json", "--format", "html", "--out", html], sb.dir)).code).toBe(0);
    expect(await readFile(join(html, "guide.html"), "utf8")).toContain("data:image/png;base64,");
  });
  it("unknown format and missing --out are usage errors", async () => {
    expect((await cli(["export", "guide.showsteps", "--format", "rtf", "--out", "o"], sb.dir)).code).toBe(2);
    expect((await cli(["export", "guide.showsteps", "--format", "md"], sb.dir)).code).toBe(2);
  });
});

describe("legacy names and warnings", () => {
  it("a bundle named .stepsnap still opens (detected by content) and saves as a bundle", async () => {
    const legacy = join(sb.dir, "old.stepsnap");
    await writeFile(legacy, await readFile(sb.bundle));
    expect((await cli(["validate", "old.stepsnap"], sb.dir)).code).toBe(0);
    const out = join(sb.dir, "resaved.stepsnap");
    expect((await cli(["edit-step", "old.stepsnap", "--id", "s1", "--description", "x", "--out", out], sb.dir)).code).toBe(0);
    expect((await readFile(out)).subarray(0, 2).toString()).toBe("PK");
  });
  it("guide.json with missing screenshots validates with warnings on stderr and in JSON", async () => {
    await mkdir(join(sb.dir, "noimg"), { recursive: true });
    await writeFile(join(sb.dir, "noimg", "guide.json"), await readFile(sb.json));
    const r = await cli(["validate", "noimg/guide.json", "--json"], sb.dir);
    expect(r.code).toBe(0);
    expect(json(r).warnings).toHaveLength(4);
    const info = json(await cli(["info", "noimg/guide.json", "--json"], sb.dir));
    expect(info.screenshots).toMatchObject({ steps: 4, imagesFound: 0, imagesMissing: 4 });
  });
  it("converting such a guide to a bundle fails cleanly (exit 1), not with a stack trace", async () => {
    const r = await cli(["edit-step", "noimg/guide.json", "--id", "s1", "--description", "x", "--out", join(sb.dir, "noimg.showsteps")], sb.dir);
    expect(r.code).toBe(1);
    expect(r.err).toContain("cannot save");
  });
});

describe("new --from-steps", () => {
  it("creates a valid bundle from an agent steps file", async () => {
    await writeFile(join(sb.dir, "steps-input.json"), JSON.stringify(STEPS_INPUT));
    const out = join(sb.dir, "made.showsteps");
    const r = await cli(["new", "--from-steps", "steps-input.json", "--out", out, "--json"], sb.dir);
    expect(r.code).toBe(0);
    await expect(pretty(json(r))).toMatchFileSnapshot(golden("new.json"));
    expect((await cli(["validate", out], sb.dir)).code).toBe(0);
    const listed = await cli(["steps", out, "--json"], sb.dir);
    await expect(pretty(json(listed).steps.map((s: any) => ({ id: s.id, title: s.title, action: s.action, target: s.target, sensitive: s.sensitive })))).toMatchFileSnapshot(golden("new.steps.json"));
    const pw = join(sb.dir, "made-pw");
    expect((await cli(["export", out, "--format", "skill", "--out", pw], sb.dir)).code).toBe(0);
  });
  it("accepts a bare array and --title, writes .json by extension", async () => {
    await writeFile(join(sb.dir, "arr.json"), JSON.stringify([{ action: "click", target: "Save", url: "https://app.example.test/" }]));
    const out = join(sb.dir, "arr-out.json");
    const r = await cli(["new", "--from-steps", "arr.json", "--out", out, "--title", "Save it", "--json"], sb.dir);
    expect(r.code).toBe(0);
    expect(json(r)).toMatchObject({ format: "json", title: "Save it", steps: 1 });
    expect(JSON.parse(await readFile(out, "utf8")).title).toBe("Save it");
  });
  it("reports every problem in the steps file: exit 1", async () => {
    await writeFile(join(sb.dir, "bad-steps.json"), JSON.stringify({ title: "T", steps: [{ action: "type", target: "Email" }, { action: "fly" }, { action: "note" }] }));
    const r = await cli(["new", "--from-steps", "bad-steps.json", "--out", join(sb.dir, "z.showsteps"), "--json"], sb.dir);
    expect(r.code).toBe(1);
    expect(json(r).error.errors).toHaveLength(3);
  });
  it("missing steps file: exit 3; not JSON: exit 1; missing options: exit 2", async () => {
    expect((await cli(["new", "--from-steps", "missing.json", "--out", "o.showsteps"], sb.dir)).code).toBe(3);
    await writeFile(join(sb.dir, "notjson.json"), "{");
    expect((await cli(["new", "--from-steps", "notjson.json", "--out", "o.showsteps"], sb.dir)).code).toBe(1);
    expect((await cli(["new", "--out", "o.showsteps"], sb.dir)).code).toBe(2);
  });
});

describe("usage", () => {
  it("--help and --version exit 0", async () => {
    const h = await cli(["--help"], sb.dir);
    expect(h.code).toBe(0);
    expect(h.out).toContain("Exit codes: 0 ok, 1 invalid input, 2 usage error, 3 file error.");
    expect((await cli(["--version"], sb.dir)).code).toBe(0);
  });
  it("no command, unknown command, unknown option: exit 2, nothing on stdout", async () => {
    for (const args of [[], ["frobnicate"], ["validate", "guide.showsteps", "--wat"], ["validate"]]) {
      const r = await cli(args, sb.dir);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.out).toBe("");
      expect(r.err.length).toBeGreaterThan(0);
    }
  });
  it("usage error with --json still prints one JSON object", async () => {
    const r = await cli(["validate", "--json"], sb.dir);
    expect(r.code).toBe(2);
    expect(json(r)).toMatchObject({ ok: false, error: { code: "usage" } });
  });
});
