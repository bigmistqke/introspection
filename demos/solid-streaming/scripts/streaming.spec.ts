import { attach } from "@introspection/playwright";
import { defaults } from "@introspection/plugin-defaults";
import { solidDevtools } from "@introspection/plugin-solid-devtools";
import { expect, test } from "@playwright/test";

test("streaming demo auto-connects and streams events", async ({ page }) => {
  const startTime = Date.now();

  const handle = await attach(page, {
    testTitle: "streaming demo",
    plugins: [...defaults(), solidDevtools()],
    outDir: ".introspect",
  });

  await handle.page.goto("/");

  // Screenshot: connected, events streaming in
  await handle.page.screenshot();

  // Wait for events to stream in
  await handle.page.waitForSelector(".event", { timeout: 10000 });

  // Should have multiple events in the timeline
  const eventCount = await handle.page.locator(".event").count();
  expect(eventCount).toBeGreaterThan(0);

  // Screenshot: stream complete, all events visible
  await handle.page.screenshot();

  // Click an event to see detail
  await handle.page.locator(".event").first().click();

  // Detail panel should show event data
  await expect(handle.page.locator(".detail h3")).toBeVisible();

  // Screenshot: event selected, detail panel showing
  await handle.page.screenshot();

  await handle.detach({ status: "passed", duration: Date.now() - startTime });
});
