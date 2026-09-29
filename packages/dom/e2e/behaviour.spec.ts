import { expect, test } from "./harness";

test("resolveTarget in real Chrome: icons, labels, shadow DOM, contenteditable", async ({ page }) => {
  await page.goto("/settings.html");
  await page.waitForSelector("acme-tip");
  await page.evaluate(() => {
    (window as unknown as { __hits: string[] }).__hits = [];
    document.addEventListener(
      "click",
      (e) => {
        const el = ShowstepsDom.resolveTarget(e);
        const host = (el.getRootNode() as ShadowRoot).host;
        (window as unknown as { __hits: string[] }).__hits.push(`${host ? `${host.localName} >> ` : ""}${el.localName}#${el.id}`);
      },
      true,
    );
  });
  const hits = () => page.evaluate(() => (window as unknown as { __hits: string[] }).__hits);

  // click on the text of a wrapping label resolves to the checkbox
  await page.getByText("Email me invoices").click();
  expect((await hits()).at(-1)).toBe("input#email-invoices");
  // click on the <span> inside a shadow-DOM button resolves to the shadow button
  await page.locator("acme-tip").getByText("Show tip").click();
  expect((await hits()).at(-1)).toBe("acme-tip >> button#tip-btn");
  // click inside a contenteditable
  await page.locator("#signature").click();
  expect((await hits()).at(-1)).toBe("div#signature");
  // click on the icon svg of an icon-only button (dashboard page)
  await page.goto("/dashboard.html");
  await page.evaluate(() => {
    (window as unknown as { __hits: string[] }).__hits = [];
    document.addEventListener("click", (e) => (window as unknown as { __hits: string[] }).__hits.push(ShowstepsDom.resolveTarget(e).id), true);
  });
  await page.locator("#add-book svg").click();
  expect(await hits()).toEqual(["add-book"]);
});

test("rectOf adds iframe offsets and pageMetrics reports scroll and dpr", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/settings.html");
  await page.locator("#confirm-frame").scrollIntoViewIfNeeded();
  const frame = page.frames().find((f) => f.url().endsWith("/frame.html"))!;
  await frame.waitForLoadState("load");
  const box = (await frame.locator("#frame-confirm").boundingBox())!; // main-frame viewport coordinates
  const inFrame = await frame.evaluate(() => ShowstepsDom.rectOf(document.querySelector("#frame-confirm")!));
  expect(Math.abs(inFrame.x - box.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(inFrame.y - box.y)).toBeLessThanOrEqual(1);
  expect(inFrame.width).toBeCloseTo(box.width, 0);
  const local = await frame.evaluate(() => ShowstepsDom.rectOf(document.querySelector("#frame-confirm")!, { topLevel: false }));
  expect(local.x).toBeLessThan(inFrame.x);

  const m = await frame.evaluate(() => ShowstepsDom.pageMetrics());
  const top = await page.evaluate(() => ({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight, y: Math.round(scrollY) }));
  expect(m.devicePixelRatio).toBe(top.dpr);
  expect(m.viewport).toEqual({ width: top.w, height: top.h, scrollX: 0, scrollY: top.y });
  expect(top.y).toBeGreaterThan(0);
});

test("sensitiveRects reaches into the iframe and the shadow root and matches real boxes", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 2600 });
  await page.goto("/settings.html");
  await page.waitForSelector("acme-tip");
  const frame = page.frames().find((f) => f.url().endsWith("/frame.html"))!;
  await frame.waitForLoadState("load");
  const rects = await page.evaluate(() => ShowstepsDom.sensitiveRects());
  const expectedBoxes = [
    await page.locator("#card-number").boundingBox(),
    await page.locator("#card-expiry").boundingBox(),
    await page.locator("#card-cvc").boundingBox(),
    await page.locator("acme-tip").locator("#tip-pin").boundingBox(),
    await frame.locator("#frame-code").boundingBox(),
  ];
  expect(rects).toHaveLength(5);
  for (const b of expectedBoxes) {
    const hit = rects.find((r) => Math.abs(r.x - b!.x) <= 1 && Math.abs(r.y - b!.y) <= 1 && Math.abs(r.width - b!.width) <= 1 && Math.abs(r.height - b!.height) <= 1);
    expect(hit, JSON.stringify(b)).toBeTruthy();
  }
});

test("typed secrets never appear in any descriptor", async ({ page }) => {
  await page.goto("/settings.html");
  await page.locator("#card-number").fill("4242 4242 4242 4242");
  await page.locator("#signature").fill("Kind regards, Jane");
  const dump = await page.evaluate(() =>
    JSON.stringify(["#card-number", "#signature", "#notes", "#full-name"].map((s) => ShowstepsDom.describeElement(document.querySelector(s)!))),
  );
  expect(dump).not.toContain("4242");
  expect(dump).not.toContain("Kind regards");
});
