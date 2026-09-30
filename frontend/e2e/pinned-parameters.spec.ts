import { expect, test } from "./coverage";
import { mockLiveHeatmapApi, openLiveHeatmap } from "./liveHeatmap";

const snapshot = {
  dac_ch1: { value: 0, unit: "V", label: "Voltage 1" },
  dmm_v1: { value: 5.0760782441045915, unit: "V", label: "Voltmeter" },
};

test("pins a qanary parameter to a floating window", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await mockLiveHeatmapApi(page);
  const requested: string[][] = [];
  await page.route("**/load-meta/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/load-meta/parameters/") {
      const { names } = route.request().postDataJSON() as { names: string[] };
      requested.push(names);
      await route.fulfill({
        json: {
          parameters: names.map((name) =>
            name === "dmm_v1"
              ? { name, label: "Voltmeter", display: "5.076 V" }
              : { name, missing: true },
          ),
        },
      });
    } else {
      await route.fulfill({ json: { "Parameters Snapshot": JSON.stringify(snapshot) } });
    }
  });
  await openLiveHeatmap(page);

  await page.getByRole("button", { name: "Metadata" }).click();
  await page.getByText('"dmm_v1"').hover();
  await page.getByRole("button", { name: "Pin dmm_v1" }).click();

  const pinnedWindow = page.getByRole("dialog", { name: "Pinned parameters" });
  await expect(pinnedWindow.getByText("Voltmeter")).toBeVisible();
  await expect(pinnedWindow.getByLabel("dmm_v1 value")).toHaveText("5.076 V");
  expect(requested.at(-1)).toEqual(["dmm_v1"]);
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/pins.png` });

  // The same Metadata control now removes the pin.
  await page.getByText('"dmm_v1"').hover();
  await page.getByRole("button", { name: "Unpin dmm_v1" }).first().click();
  await expect(pinnedWindow).toHaveCount(0);
});
