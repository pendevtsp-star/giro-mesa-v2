import { expect, type Page, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function waitForStableVisualState(page: Page) {
  const images = page.locator("img");
  for (let index = 0; index < (await images.count()); index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(async (element) => {
      if (!element.complete) {
        await new Promise<void>((resolve) => {
          element.addEventListener("load", () => resolve(), { once: true });
          element.addEventListener("error", () => resolve(), { once: true });
        });
      }
      if (element.naturalWidth === 0)
        throw new Error(`Imagem não carregada: ${element.currentSrc}`);
      await element.decode();
    });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.waitForFunction(
    () => {
      const visualWindow = window as typeof window & {
        __giromesaVisualState?: { frames: number; signature: string };
      };
      const root = document.documentElement;
      const signature = [
        root.scrollWidth,
        root.scrollHeight,
        ...Array.from(document.images).flatMap((image) => {
          const rect = image.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height, image.naturalWidth, image.naturalHeight];
        }),
      ].join("|");
      const previous = visualWindow.__giromesaVisualState;
      visualWindow.__giromesaVisualState = {
        frames: previous?.signature === signature ? previous.frames + 1 : 1,
        signature,
      };
      return visualWindow.__giromesaVisualState.frames >= 3;
    },
    undefined,
    { polling: "raf" },
  );
  await page.evaluate(() => {
    delete (window as typeof window & { __giromesaVisualState?: unknown }).__giromesaVisualState;
  });
}

for (const viewport of viewports) {
  test(`landing visual ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://localhost:3110");
    await expect(page.locator('[aria-roledescription="carrossel"]')).toBeVisible();
    await waitForStableVisualState(page);
    await expect(page).toHaveScreenshot(`landing-${viewport.name}.png`, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
    });
  });
}
