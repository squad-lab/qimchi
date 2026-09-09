import MCR from "monocart-coverage-reports";

import coverageOptions from "./coverage-config";

export default async function coverageTeardown() {
  await MCR(coverageOptions).generate();
}
