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

## Release notes

Keep stable release summaries in [CHANGELOG.md](CHANGELOG.md), with one `### vX.Y.Z - YYYY-MM-DD` section per release.

Preview notes live in `md/release-notes/vX.Y.Z-rc.N.md`, headed `### vX.Y.Z-rc.N - YYYY-MM-DD`. Describe changes since the previous candidate; the first candidate compares with the previous stable release. Reuse the corresponding changelog entries verbatim and preserve published candidate notes. The preview history starts with [v0.7.1-rc.1](md/release-notes/v0.7.1-rc.1.md).

Before running the manual `tag_preview` CI job on `preview`, add the file for the next unused RC number. CI refuses to tag a preview without its notes. If the stable version is already tagged, update the project version before preparing another candidate.

Release descriptions and update prompts use the notes at the offered tag. Settings > Updates uses the same sources bundled with the running build, including offline.
