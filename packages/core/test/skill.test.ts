import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { exportAgentSkill, exportPlaywright, generateStepTitle, STEPS_JSON_SCHEMA, type Guide, type Step, type StepsJson } from "../src";
import schemaFile from "../schema/steps.schema.json";
import { fixtureGuide, fixtureImages } from "./fixtures/guide";
import { SAMPLE_CANARY_PASSWORD, sample11Guide, sample11Images } from "./fixtures/sample11";
import { expectGolden } from "./golden";

const guide = fixtureGuide();
const text = (f: string | Uint8Array | undefined): string => (typeof f === "string" ? f : new TextDecoder().decode(f));

const AjvCtor = ((Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020) as typeof Ajv2020;
const ajv = new AjvCtor({ strict: false, allErrors: true });
const validateSteps = ajv.compile(schemaFile);
const schemaErrors = (x: unknown): string[] => (validateSteps(x) ? [] : (validateSteps.errors ?? []).map((e) => `${e.instancePath} ${e.message}`));

const LEAK = "hunter2-Sup3rSecret";
function leakyGuide(): Guide {
  const g = fixtureGuide();
  return {
    ...g,
    steps: g.steps.map((s): Step => {
      if (s.id !== "s_pass") return s;
      const leaky = { ...s, action: { type: "type" as const, value: LEAK } };
      return { ...leaky, title: generateStepTitle(leaky) };
    }),
  };
}

function frontmatter(md: string): { name: string; description: string } {
  const m = /^---\nname: (".*")\ndescription: (".*")\n---\n/.exec(md);
  expect(m, "SKILL.md must start with YAML frontmatter").not.toBeNull();
  return { name: JSON.parse(m?.[1] ?? '""') as string, description: JSON.parse(m?.[2] ?? '""') as string };
}

describe("exportAgentSkill (small fixture)", () => {
  const { files } = exportAgentSkill(guide);
  const skillMd = text(files["SKILL.md"]);
  const stepsJson = JSON.parse(text(files["steps.json"])) as StepsJson;

  it("matches the golden files", () => {
    expectGolden("skill/SKILL.md", skillMd);
    expectGolden("skill/steps.json", text(files["steps.json"]));
    expect(Object.keys(files)).toEqual(["SKILL.md", "replay.spec.ts", "steps.json"]);
  });

  it("numbers the steps and gives locator hints", () => {
    expect(skillMd).toContain("1. Go to **Sign in** on Acme");
    expect(skillMd).toContain("10. Press **Enter** to search");
    expect(skillMd).toContain('Find it by: test id "signin-button"');
    expect(skillMd).toContain("inside iframe `iframe[name=\"card-frame\"]`");
    expect(skillMd).toContain("`SHOWSTEPS_SECRET_1`");
  });

  it("writes a versioned steps.json in the PLAN shape", () => {
    expect(stepsJson.format).toBe("showsteps-steps");
    expect(stepsJson.version).toBe(1);
    expect(stepsJson.guide).toMatchObject({ id: "g_fixture", stepCount: 10, tabCount: 2 });
    expect(stepsJson.steps.map((s) => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stepsJson.steps[2]?.action).toEqual({ type: "type", masked: true, secret: "SHOWSTEPS_SECRET_1" });
    expect(stepsJson.secrets).toEqual([{ env: "SHOWSTEPS_SECRET_1", step: 3, field: "Password" }]);
    expect(stepsJson.steps[8]?.page.tabIndex).toBe(2);
    expect(stepsJson.steps[1]?.replay.playwright).toContain("getByLabel");
    expect(stepsJson.steps[7]?.frame).toEqual(['iframe[name="card-frame"]']);
    expect(stepsJson.steps[0]?.locators).toEqual([]);
    expect(stepsJson.steps[1]?.locators[0]).toEqual({ kind: "label", value: "Email" });
    expect(stepsJson.startUrl).toBe("https://app.acme.test/login");
  });

  it("has sorted keys, so the bytes do not depend on how the guide was built", () => {
    const json = text(files["steps.json"]);
    expect(json.indexOf('"format"')).toBeLessThan(json.indexOf('"generator"'));
    expect(json.indexOf('"generator"')).toBeLessThan(json.indexOf('"guide"'));
    expect(json.endsWith("}\n")).toBe(true);
  });

  it("never leaks a secret, even if the guide contains one", () => {
    for (const [name, content] of Object.entries(exportAgentSkill(leakyGuide()).files)) expect(text(content), name).not.toContain(LEAK);
  });

  it("can include rendered images, referenced from steps.json and SKILL.md", () => {
    const withImages = exportAgentSkill(guide, { images: fixtureImages() }).files;
    expect(Object.keys(withImages)).toContain("images/s_email.png");
    expect(text(withImages["SKILL.md"])).toContain("`images/`");
    expect((JSON.parse(text(withImages["steps.json"])) as StepsJson).steps[1]?.screenshot).toBe("images/s_email.png");
    expect(schemaErrors(JSON.parse(text(withImages["steps.json"])))).toEqual([]);
  });

  it("names the skill from the title: default, override, no reserved words, no letters", () => {
    expect(frontmatter(skillMd).name).toBe("update-billing-settings-in-acme");
    expect(frontmatter(text(exportAgentSkill({ ...guide, title: "☃☃" }).files["SKILL.md"])).name).toBe("recorded-workflow");
    expect(frontmatter(text(exportAgentSkill({ ...guide, title: "Claude Anthropic export flow" }).files["SKILL.md"])).name).toBe("export-flow");
    expect(frontmatter(text(exportAgentSkill({ ...guide, title: "Ask CLAUDE about billing" }).files["SKILL.md"])).name).toBe("ask-about-billing");
    expect(frontmatter(text(exportAgentSkill({ ...guide, title: "x".repeat(200) }).files["SKILL.md"])).name.length).toBe(64);
    expect(frontmatter(text(exportAgentSkill(guide, { name: "my-skill", description: "Does a thing. Use when asked." }).files["SKILL.md"]))).toEqual({ name: "my-skill", description: "Does a thing. Use when asked." });
  });

  it("clamps the description to 1024 characters", () => {
    const long = frontmatter(text(exportAgentSkill(guide, { description: "word ".repeat(500) }).files["SKILL.md"])).description;
    expect(long.length).toBeLessThanOrEqual(1024);
  });
});

describe("steps.schema.json", () => {
  it("is exported from the package and is a valid 2020-12 schema", () => {
    expect(STEPS_JSON_SCHEMA).toEqual(schemaFile);
    expect(ajv.validateSchema(schemaFile)).toBe(true);
  });

  const good = JSON.parse(text(exportAgentSkill(guide).files["steps.json"])) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const bad: [string, (j: Record<string, any>) => void][] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
    ["wrong format", (j) => (j.format = "other")],
    ["wrong version", (j) => (j.version = 2)],
    ["missing steps", (j) => delete j.steps],
    ["step without index", (j) => delete j.steps[0].index],
    ["step index 0", (j) => (j.steps[0].index = 0)],
    ["unknown action", (j) => (j.steps[0].action = { type: "teleport" })],
    ["type with both value and masked", (j) => (j.steps[1].action = { type: "type", value: "a", masked: true, secret: "SHOWSTEPS_SECRET_1" })],
    ["masked without secret", (j) => (j.steps[2].action = { type: "type", masked: true })],
    ["bad secret name", (j) => (j.secrets[0].env = "PASSWORD")],
    ["locator with unknown kind", (j) => (j.steps[1].locators[0] = { kind: "magic", value: "x" })],
    ["role locator without name", (j) => (j.steps[3].locators = [{ kind: "role", role: "button" }])],
    ["extra property on a step", (j) => (j.steps[0].image = "data:image/png;base64,AAAA")],
    ["extra top-level property", (j) => (j.images = {})],
    ["screenshot outside images/", (j) => (j.steps[1].screenshot = "/etc/passwd")],
    ["tabIndex 0", (j) => (j.steps[0].page.tabIndex = 0)],
    ["frame not strings", (j) => (j.steps[7].frame = [1])],
  ];
  it("accepts the exporter's output", () => expect(schemaErrors(good)).toEqual([]));
  it.each(bad)("rejects: %s", (_n, mutate) => {
    const j = JSON.parse(JSON.stringify(good)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    mutate(j);
    expect(schemaErrors(j).length).toBeGreaterThan(0);
  });
});

describe("exportAgentSkill (sample-11, B-SKILL)", () => {
  const sample = sample11Guide();
  const { files } = exportAgentSkill(sample);
  const skillMd = text(files["SKILL.md"]);
  const steps = JSON.parse(text(files["steps.json"])) as StepsJson;

  it("returns SKILL.md, steps.json and replay.spec.ts, and images only when asked", () => {
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "replay.spec.ts", "steps.json"]);
    expect(Object.keys(exportAgentSkill(sample, { images: sample11Images() }).files).filter((k) => k.startsWith("images/")).length).toBe(11);
  });

  it("has valid frontmatter: name pattern, at most 64 chars, no reserved words; description 1-1024 chars", () => {
    const { name, description } = frontmatter(skillMd);
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(name.length).toBeLessThanOrEqual(64);
    expect(name).not.toMatch(/claude|anthropic/);
    expect(description.length).toBeGreaterThanOrEqual(1);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).toMatch(/Use when/);
    expect(description).toContain("workflow");
  });

  it("lists as many numbered steps as there are visible steps, and every secret variable", () => {
    const numbered = [...skillMd.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbered).toEqual(Array.from({ length: 11 }, (_, i) => i + 1));
    for (const s of steps.secrets) expect(skillMd).toContain(`\`${s.env}\``);
    expect(steps.secrets.length).toBe(1);
  });

  it("steps.json validates against the schema, has no image data, no masked value, no canary", () => {
    expect(schemaErrors(steps)).toEqual([]);
    const raw = text(files["steps.json"]);
    expect(raw).not.toMatch(/data:image|base64,/);
    expect(raw).not.toContain(SAMPLE_CANARY_PASSWORD);
    expect(skillMd).not.toContain(SAMPLE_CANARY_PASSWORD);
    expect(steps.steps.filter((s) => s.action.type === "type" && "masked" in s.action).length).toBe(1);
    expect(steps.steps.every((s) => s.screenshot === undefined)).toBe(true);
  });

  it("replay.spec.ts byte-equals exportPlaywright for the same guide", () => {
    expect(text(files["replay.spec.ts"])).toBe(exportPlaywright(sample));
    expectGolden("skill/sample-11.replay.spec.ts.golden", text(files["replay.spec.ts"]));
  });

  it("goldens", () => {
    expectGolden("skill/sample-11.SKILL.md", skillMd);
    expectGolden("skill/sample-11.steps.json", text(files["steps.json"]));
  });
});
