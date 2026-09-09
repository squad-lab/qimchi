import { expect, test as base } from "@playwright/test";
import MCR from "monocart-coverage-reports";

import coverageOptions from "./coverage-config";

const test = base.extend<{ collectCoverage: void }>({
  collectCoverage: [
    async ({ page }, use, testInfo) => {
      const enabled = testInfo.project.name === "chromium";
      if (enabled) {
        await page.coverage.startJSCoverage({ resetOnNavigation: false });
      }

      await use();

      if (enabled) {
        const coverage = await page.coverage.stopJSCoverage();
        await MCR(coverageOptions).add(coverage);
      }
    },
    { auto: true },
  ],
});

export { expect, test };
