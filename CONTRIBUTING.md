# Contributing to Qimchi

Keep changes focused, add tests for new behavior or bug fixes, and describe the changes and checks in your merge request. Include screenshots for visible interface changes.

## Development setup

Use Python 3.13 or later, uv, and Node.js 22.12 or later. See the README's [manual installation instructions](README.md#expert-installation) for system dependencies, image-export setup and the backend launch command.

From the repository root, install the backend development tools and dataset readers:

```sh
cd backend
uv sync --locked --extra dev --extra datasets
```

Install the frontend dependencies:

```sh
cd ../frontend
npm ci
```

To enable the repository's pre-commit hooks, run `uv run pre-commit install` from `backend/` after installing its development dependencies.

## Checks

Run the checks for the parts you change. For backend changes, run these from `backend/`:

```sh
uv run --no-sync ruff check .
uv run --no-sync ruff format --check .
uv lock --check
uv run --no-sync pytest --cov
```

For frontend changes, run these from `frontend/`:

```sh
npm run lint
npm run format:check
npm run build
npm run test:unit -- --coverage
npx playwright install chromium
npm run test:e2e
```

Playwright starts the frontend development server automatically. On Linux, use `npx playwright install --with-deps chromium` if browser system dependencies are missing.

Use `uv run ruff check --fix .` and `uv run ruff format .` in `backend/`, or `npm run lint:fix` and `npm run format` in `frontend/`, to apply automatic fixes. Review the resulting diff before committing.

## Test strategy

Qimchi has four test suites. CI runs the first three on every branch and merge request. All three must pass before merging.

- **Backend** (`backend/tests/`, pytest): API endpoints, loaders for all supported formats, filters, plot generation, the library database and migrations, live measurements, export, updates and diagnostics. Minimum coverage is 75% (`fail_under` in `backend/pyproject.toml`). Tests that require optional packages or hardware are skipped.
- **Frontend units** (`npm run test:unit`, Vitest in jsdom): stores and utilities. Coverage floors are set in `frontend/vitest.config.ts`.
- **Frontend end to end** (`npm run test:e2e`, Playwright in Chromium): interface workflows using shared backend mocks in `e2e/liveHeatmap.ts` and `e2e/settingsMock.ts`. Coverage floors are set in `frontend/e2e/coverage-config.ts`.
- **Packaged app** (`scripts/run_packaged_smoke.py`): checks that each desktop build starts and serves the backend, bundled interface and downloads. Windows and Linux run these checks headless. Before release, the Linux AppImage must also pass windowed checks on a virtual display on Ubuntu, Debian, Fedora and Arch Linux.

Include a regression test with each bug fix. Test new features at the lowest level that verifies their behaviour, and add end-to-end tests for interface workflows. Explain any reduction in coverage thresholds in the merge request.

## Release notes

Keep stable release summaries in [CHANGELOG.md](CHANGELOG.md), with one `### vX.Y.Z - YYYY-MM-DD` section per release.

Preview notes live in `md/release-notes/vX.Y.Z-rc.N.md`, headed `### vX.Y.Z-rc.N - YYYY-MM-DD`. Describe changes since the previous candidate; the first candidate compares with the previous stable release. Reuse the corresponding changelog entries verbatim and preserve published candidate notes. The preview history starts with [v0.7.1-rc.1](md/release-notes/v0.7.1-rc.1.md).

Before running the manual `tag_preview` CI job on `preview`, add the file for the next unused RC number. CI refuses to tag a preview without its notes. If the stable version is already tagged, update the project version before preparing another candidate.

Release descriptions and update prompts use the notes at the offered tag. Settings > Updates uses the same sources bundled with the running build, including offline.
