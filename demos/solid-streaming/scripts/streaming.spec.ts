import { attachRun } from "@introspection/playwright";
import { defaults } from "@introspection/plugin-defaults";
import { solidDevtools } from "@introspection/plugin-solid-devtools";
import { expect, test } from "@playwright/test";

// SKIPPED: blocked on Spec C. This demo reads traces over HTTP via
// createFetchAdapter → introspectionServe (createHandler), which can't serve
// or navigate the <run-id>/<session-id>/ hierarchy yet. Un-skip when Spec C
// (whole-tree createHandler + fetch-adapter subPath) lands.
// See docs/superpowers/specs/2026-05-14-remote-trace-cli-design.md.
test.skip("streaming demo auto-connects and streams events", async ({ page }) => {
  const startTime = Date.now();

  const handle = await attachRun(page, {
    testTitle: "streaming demo",
    plugins: [...defaults(), solidDevtools()],
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
