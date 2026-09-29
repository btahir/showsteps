import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STEPS_INPUT, makeSandbox, type Sandbox } from "../../cli/test/fixture.ts";

const server = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "showsteps-mcp.js");

let sb: Sandbox;
let client: Client;

beforeAll(async () => {
  sb = await makeSandbox();
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));
});
afterAll(async () => {
  await client.close();
  await rm(sb.dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  return r as { isError?: boolean; structuredContent?: any; content: { type: string; text: string }[] };
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}

describe("tool catalogue", () => {
  it("lists exactly the seven documented tools with schemas and descriptions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_guide_from_steps",
      "edit_step",
      "export_guide",
      "guide_info",
      "list_steps",
      "regenerate_titles",
      "validate_guide",
    ]);
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties, `${t.name} rejects unknown arguments`).toBe(false);
      expect(t.inputSchema.required?.length, `${t.name} has a required argument`).toBeGreaterThan(0);
    }
    // nested step objects are strict too
    const steps = tools.find((t) => t.name === "create_guide_from_steps")!.inputSchema.properties as any;
    expect(steps.steps.items.additionalProperties).toBe(false);
    const exp = tools.find((t) => t.name === "export_guide")!;
    expect((exp.inputSchema.properties as any).format.enum).toEqual(["md", "html", "pdf", "docx", "playwright", "skill", "project", "all"]);
    expect(exp.inputSchema.required).toEqual(["path", "format", "out_dir"]);
    expect((exp.inputSchema.properties as any).format.enum).toContain("project");
    expect(tools.find((t) => t.name === "guide_info")!.annotations?.readOnlyHint).toBe(true);
  });
});

describe("files by path only (strict schemas)", () => {
  const rejected = async (name: string, args: Record<string, unknown>) => {
    const r = await call(name, args).catch((e) => ({ isError: true, content: [{ type: "text", text: String(e) }] }) as any);
    expect(r.isError, `${name} ${JSON.stringify(Object.keys(args))}`).toBe(true);
    return r;
  };
  it("an extra argument (a base64 image, or anything else) is rejected, not ignored", async () => {
    await rejected("validate_guide", { path: sb.bundle, image: "iVBORw0KGgo=" });
    await rejected("guide_info", { path: sb.bundle, extra: 1 });
    await rejected("list_steps", { path: sb.bundle, image_base64: "AAAA" });
    await rejected("edit_step", { path: sb.bundle, step_id: "s1", title: "x", image: "AAAA", out_path: join(sb.dir, "strict-a.showsteps") });
    await rejected("regenerate_titles", { path: sb.bundle, data: "AAAA", out_path: join(sb.dir, "strict-b.showsteps") });
    await rejected("export_guide", { path: sb.bundle, format: "md", out_dir: join(sb.dir, "strict-c"), image: "AAAA" });
    await rejected("create_guide_from_steps", { out_path: join(sb.dir, "strict-d.showsteps"), title: "T", steps: [{ action: "click", target: "Save", image: "AAAA" }] });
    await rejected("create_guide_from_steps", { out_path: join(sb.dir, "strict-e.showsteps"), title: "T", images: {}, steps: [{ action: "click", target: "Save" }] });
    for (const f of ["strict-a.showsteps", "strict-b.showsteps", "strict-d.showsteps", "strict-e.showsteps"]) await expect(readFile(join(sb.dir, f))).rejects.toThrow();
    await expect(readdir(join(sb.dir, "strict-c"))).rejects.toThrow();
  });
  it("the server keeps serving after a rejected call", async () => {
    expect((await call("validate_guide", { path: sb.bundle })).structuredContent.valid).toBe(true);
  });
});

describe("read tools", () => {
  it("validate_guide on a bundle", async () => {
    const r = await call("validate_guide", { path: sb.bundle });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({ valid: true, file: sb.bundle, format: "bundle", schemaVersion: 1, steps: 6, warnings: [] });
    expect(JSON.parse(r.content[0]!.text)).toEqual(r.structuredContent);
  });
  it("validate_guide reports invalid content as data, not a tool error", async () => {
    const bad = join(sb.dir, "bad.json");
    await writeFile(bad, JSON.stringify({ schemaVersion: 1, steps: 3 }));
    const r = await call("validate_guide", { path: bad });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.valid).toBe(false);
    expect(r.structuredContent.errors.length).toBeGreaterThan(0);
  });
  it("a missing file is a tool error with code io", async () => {
    const r = await call("guide_info", { path: join(sb.dir, "missing.showsteps") });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.code).toBe("io");
  });
  it("relative paths are rejected", async () => {
    const r = await call("guide_info", { path: "guide.showsteps" });
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain("absolute");
  });
  it("guide_info", async () => {
    const r = await call("guide_info", { path: sb.bundle });
    const j = r.structuredContent;
    expect(j).toMatchObject({
      title: "Set up billing",
      stepCount: 6,
      activeSteps: 5,
      skippedSteps: 1,
      actions: { click: 1, navigate: 1, press: 1, select: 1, type: 2 },
      screenshots: { steps: 4, imagesFound: 4, imagesMissing: 0 },
      redactions: 1,
    });
    expect(j.sensitiveSteps.map((s: any) => s.id)).toEqual(["s3"]);
    expect(j.stepTitles).toHaveLength(6);
    expect(j.sizeBytes).toBe((await readFile(sb.bundle)).length);
    expect(j.pages.map((p: any) => p.url)).toEqual(["https://app.example.test/login", "https://app.example.test/settings"]);
  });
  it("list_steps, with and without skipped, never shows a masked value", async () => {
    const all = await call("list_steps", { path: sb.bundle });
    expect(all.structuredContent.steps.map((s: any) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    const s3 = all.structuredContent.steps[2];
    expect(s3).toMatchObject({ index: 3, sensitive: true, action: { type: "type", value: "•••", masked: true }, target: "Password" });
    const active = await call("list_steps", { path: sb.json, include_skipped: false });
    expect(active.structuredContent.steps.map((s: any) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  });
});

describe("write tools", () => {
  it("edit_step to out_path leaves the source untouched", async () => {
    const out = join(sb.dir, "mcp-edited.showsteps");
    const r = await call("edit_step", { path: sb.bundle, step_id: "s5", title: "Choose **Monthly** billing", description: "Pick monthly.", skipped: true, out_path: out });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ out, changed: ["title", "description", "skipped"], step: { id: "s5", title: "Choose **Monthly** billing", skipped: true } });
    const after = await call("list_steps", { path: out });
    expect(after.structuredContent.steps[4]).toMatchObject({ title: "Choose **Monthly** billing", skipped: true });
    const before = await call("list_steps", { path: sb.bundle });
    expect(before.structuredContent.steps[4].skipped).toBe(false);
  });
  it("edit_step unknown id and empty edit are tool errors", async () => {
    const out = join(sb.dir, "unused.showsteps");
    const a = await call("edit_step", { path: sb.bundle, step_id: "nope", title: "x", out_path: out });
    expect(a.isError).toBe(true);
    expect(a.content[0]!.text).toContain('no step with id "nope"');
    const b = await call("edit_step", { path: sb.bundle, step_id: "s1", out_path: out });
    expect(b.isError).toBe(true);
    expect(b.structuredContent.error.code).toBe("usage");
  });
  it("regenerate_titles keeps edited titles", async () => {
    const out = join(sb.dir, "mcp-regen.showsteps");
    const r = await call("regenerate_titles", { path: sb.bundle, out_path: out });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ out, steps: 6 });
    const steps = (await call("list_steps", { path: out })).structuredContent.steps;
    expect(steps[3].title).toBe("Click **Sign in**");
  });
  it("export_guide writes files and returns their absolute paths", async () => {
    const out = join(sb.dir, "mcp-export");
    const r = await call("export_guide", { path: sb.bundle, format: "all", out_dir: out });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    const written = await walk(out);
    expect(new Set(r.structuredContent.files)).toEqual(new Set(written));
    const rel = written.map((p) => relative(out, p));
    for (const f of ["guide.md", "guide.html", "guide.pdf", "guide.docx", "guide.showsteps", "replay.spec.ts", "skill/SKILL.md", "skill/steps.json", "skill/replay.spec.ts"]) {
      expect(rel).toContain(f);
    }
    expect((await readFile(join(out, "guide.pdf"))).subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.structuredContent.skill).toEqual({ name: expect.stringMatching(/^[a-z0-9-]+$/), dir: join(out, "skill") });
    for (const f of r.structuredContent.files) expect(r.structuredContent.sizes[f], f).toBe((await readFile(f)).length);
  });
  it("export_guide project writes a bundle that validates", async () => {
    const out = join(sb.dir, "mcp-project");
    const r = await call("export_guide", { path: sb.bundle, format: "project", out_dir: out });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(r.structuredContent.files).toEqual([join(out, "guide.showsteps")]);
    const v = await call("validate_guide", { path: join(out, "guide.showsteps") });
    expect(v.structuredContent).toMatchObject({ valid: true, format: "bundle", steps: 6 });
  });
  it('export_guide adds the "Made with Showsteps" line only when credit is true', async () => {
    const off = join(sb.dir, "mcp-credit-off");
    const on = join(sb.dir, "mcp-credit-on");
    expect((await call("export_guide", { path: sb.bundle, format: "md", out_dir: off })).isError).toBeFalsy();
    expect((await call("export_guide", { path: sb.bundle, format: "md", out_dir: on, credit: true })).isError).toBeFalsy();
    expect(await readFile(join(off, "guide.md"), "utf8")).not.toContain("Made with");
    expect(await readFile(join(on, "guide.md"), "utf8")).toContain("Made with");
    const { tools } = await client.listTools();
    const props = tools.find((t) => t.name === "export_guide")!.inputSchema.properties as any;
    expect(props.credit.type).toBe("boolean");
    expect(props.credit.default).toBe(false);
  });
  it("export_guide skill: names the skill and can leave images out", async () => {
    const out = join(sb.dir, "mcp-skill");
    const r = await call("export_guide", { path: sb.bundle, format: "skill", out_dir: out, skill_name: "set-up-billing", skill_description: "Use when asked to set up billing.", include_images: false });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(r.structuredContent.skill).toEqual({ name: "set-up-billing", dir: join(out, "skill") });
    expect((await walk(out)).map((p) => relative(out, p))).toEqual(["skill/SKILL.md", "skill/replay.spec.ts", "skill/steps.json"]);
    const md = await readFile(join(out, "skill", "SKILL.md"), "utf8");
    expect(md).toContain("Use when asked to set up billing.");
  });
  it("export_guide rejects an unknown format at the schema", async () => {
    const r = await call("export_guide", { path: sb.bundle, format: "rtf", out_dir: join(sb.dir, "nope") }).catch((e) => ({ isError: true, content: [{ type: "text", text: String(e) }] }));
    expect(r.isError).toBe(true);
  });
  it("create_guide_from_steps then validate, list and export the result", async () => {
    const out = join(sb.dir, "mcp-made.showsteps");
    const r = await call("create_guide_from_steps", { out_path: out, title: STEPS_INPUT.title, description: STEPS_INPUT.description, steps: STEPS_INPUT.steps });
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ out, format: "bundle", title: "Reset a password", steps: 6 });
    expect((await call("validate_guide", { path: out })).structuredContent.valid).toBe(true);
    const steps = (await call("list_steps", { path: out })).structuredContent.steps;
    expect(steps[3]).toMatchObject({ sensitive: true, action: { type: "type", masked: true } });
    const exp = await call("export_guide", { path: out, format: "skill", out_dir: join(sb.dir, "mcp-made-skill") });
    expect(exp.isError, exp.content[0]?.text).toBeFalsy();
    expect(exp.structuredContent.files.map((p: string) => relative(join(sb.dir, "mcp-made-skill"), p)).sort()).toEqual(["skill/SKILL.md", "skill/replay.spec.ts", "skill/steps.json"]);
  });
  it("create_guide_from_steps lists every problem", async () => {
    const r = await call("create_guide_from_steps", { out_path: join(sb.dir, "z.showsteps"), title: "T", steps: [{ action: "type", target: "Email" }, { action: "note" }] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.errors).toHaveLength(2);
  });
});
