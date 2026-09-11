import { readdirSync } from "node:fs";
import path from "node:path";

import type { CoverageReportOptions } from "monocart-coverage-reports";
import ts from "typescript";

const frontendRoot = process.cwd();
const repositoryRoot = path.resolve(frontendRoot, "..");
const sourceRoot = path.resolve(frontendRoot, "src");
const sourcePathByBasename = new Map(
  readdirSync(sourceRoot, { recursive: true })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => [path.basename(file), path.resolve(sourceRoot, file)]),
);

const coverageOptions: CoverageReportOptions = {
  name: "Qimchi Playwright coverage",
  outputDir: "./coverage/playwright",
  reports: [
    ["text-summary", { file: null }],
    ["html", { subdir: "html" }],
    ["lcovonly", { file: "lcov.info", projectRoot: repositoryRoot }],
    ["cobertura", { file: "cobertura-coverage.xml", projectRoot: repositoryRoot }],
  ],
  // Fails the run if coverage drops below what the suite reaches today. Set
  // just under the current figure: a floor that is already breached teaches
  // people to ignore it.
  thresholds: {
    lines: 43,
    statements: 43,
    branches: 33,
    functions: 38,
  },
  entryFilter: (entry) => /\/src\/.*\.tsx?(?:\?|$)/.test(entry.url),
  sourceFilter: (sourcePath) => /\.tsx?$/.test(sourcePath),
  sourcePath: (sourcePath) => sourcePathByBasename.get(path.basename(sourcePath)) ?? sourcePath,
  all: {
    dir: sourceRoot,
    filter: (filePath) => (/\.tsx?$/.test(filePath) && !/\.d\.ts$/.test(filePath) ? "js" : false),
    transformer: async (entry) => {
      const result = ts.transpileModule(entry.source, {
        fileName: entry.url,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          inlineSources: true,
          sourceMap: true,
          target: ts.ScriptTarget.ES2022,
        },
      });
      entry.source = result.outputText;
      if (result.sourceMapText) {
        entry.sourceMap = JSON.parse(result.sourceMapText);
      }
    },
  },
};

export default coverageOptions;
