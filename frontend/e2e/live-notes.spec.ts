import { expect, test } from "./coverage";
import { mockLiveHeatmapApi, openLiveHeatmap } from "./liveHeatmap";

test("pooled notes do not send a memory URI as the sample folder", async ({ page }) => {
  const state = await mockLiveHeatmapApi(page);
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Select measurement notes").selectOption("__sample__");

  await expect.poll(() => state.notesRequests.at(-1)?.note_scope).toBe("sample");
  const request = state.notesRequests.at(-1);
  expect(request).toMatchObject({ path: "memory://live-heat" });
  expect(request).not.toHaveProperty("sample_path");
});
