import MCR from "monocart-coverage-reports";

import coverageOptions from "./coverage-config";

export default async function coverageSetup() {
  await MCR(coverageOptions).cleanCache();
}
