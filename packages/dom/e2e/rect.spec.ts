import { expect, test } from "./harness";

// C6: rectOf(el) equals Playwright's boundingBox() (main-frame viewport coordinates) within 1 CSS px on
// every edge, for twelve elements that are hard on purpose: an inline element that wraps onto two lines,
// CSS-transformed elements, a same-origin iframe (with a border), an open shadow root, fixed positioning,
// a scrolled overflow container, a scrolled page, CSS zoom and an SVG shape.
test("C6: rectOf equals boundingBox() within 1 px for 12 hard elements", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto("/help.html");
  await page.evaluate(() => {
    document.body.innerHTML = `
      <style>
        body { margin: 0; font: 16px/1.4 sans-serif; height: 2600px; }
        .abs { position: absolute; }
      </style>
      <button id="e1" class="abs" style="left:40px;top:30px">Plain button</button>
      <p class="abs" style="left:200px;top:20px;width:110px;margin:0">Some words before <a id="e2" href="#x">a link that wraps onto two lines</a> and after.</p>
      <div id="e3" class="abs" style="left:380px;top:40px;width:120px;height:50px;background:#ddd;transform:rotate(12deg)">rotated</div>
      <div id="e4" class="abs" style="left:560px;top:60px;width:80px;height:40px;background:#ddd;transform:translate(15px,7px) scale(1.5);transform-origin:0 0">scaled</div>
      <iframe id="fr" src="/frame.html" class="abs" style="left:700px;top:20px;width:340px;height:170px;border:5px solid #999"></iframe>
      <acme-w id="host" class="abs" style="left:60px;top:150px"></acme-w>
      <button id="e8" style="position:fixed;right:20px;bottom:20px">Fixed</button>
      <div id="box" class="abs" style="left:300px;top:200px;width:200px;height:90px;overflow:auto"><div style="height:400px;padding-top:150px"><button id="e9">In scroller</button></div></div>
      <button id="e10" class="abs" style="left:120px;top:1500px">Far below</button>
      <div class="abs" style="left:560px;top:220px;zoom:1.25"><button id="e11">Zoomed</button></div>
      <svg class="abs" style="left:700px;top:260px" width="120" height="60"><rect id="e12" x="10.5" y="8" width="70" height="30" fill="#c33"/></svg>`;
    const sr = document.getElementById("host")!.attachShadow({ mode: "open" });
    sr.innerHTML = `<button id="e7" style="margin:11px">In shadow root</button>`;
    document.getElementById("box")!.scrollTop = 120;
  });
  await page.locator("#e10").scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, -200)); // leave the page scrolled, with e10 still on screen
  const frame = page.frames().find((f) => f.url().endsWith("/frame.html"))!;
  await frame.waitForLoadState("load");

  type Case = { name: string; box: () => Promise<{ x: number; y: number; width: number; height: number } | null>; rect: () => Promise<{ x: number; y: number; width: number; height: number }> };
  const inPage = (sel: string): Case => ({
    name: sel,
    box: () => page.locator(sel).boundingBox(),
    rect: () => page.evaluate((s) => ShowstepsDom.rectOf(document.querySelector(s)!), sel),
  });
  const cases: Case[] = [
    inPage("#e1"),
    inPage("#e2"),
    inPage("#e3"),
    inPage("#e4"),
    { name: "#fr #frame-confirm", box: () => frame.locator("#frame-confirm").boundingBox(), rect: () => frame.evaluate(() => ShowstepsDom.rectOf(document.querySelector("#frame-confirm")!)) },
    { name: "#fr #frame-code", box: () => frame.locator("#frame-code").boundingBox(), rect: () => frame.evaluate(() => ShowstepsDom.rectOf(document.querySelector("#frame-code")!)) },
    {
      name: "shadow #e7",
      box: () => page.locator("acme-w").locator("#e7").boundingBox(),
      rect: () => page.evaluate(() => ShowstepsDom.rectOf(document.getElementById("host")!.shadowRoot!.getElementById("e7")!)),
    },
    inPage("#e8"),
    inPage("#e9"),
    inPage("#e10"),
    inPage("#e11"),
    inPage("#e12"),
  ];
  expect(cases).toHaveLength(12);

  // The two-line link really wraps: its box is taller than one line of text.
  expect((await page.locator("#e2").boundingBox())!.height).toBeGreaterThan(30);

  const bad: string[] = [];
  for (const c of cases) {
    const b = (await c.box())!;
    const r = await c.rect();
    const edges = { left: [r.x, b.x], top: [r.y, b.y], right: [r.x + r.width, b.x + b.width], bottom: [r.y + r.height, b.y + b.height] } as const;
    for (const [edge, [got, want]] of Object.entries(edges)) if (Math.abs(got! - want!) > 1) bad.push(`${c.name} ${edge}: rectOf ${got} vs boundingBox ${want}`);
  }
  expect(bad).toEqual([]);
});
