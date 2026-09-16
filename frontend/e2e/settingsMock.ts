import type { Page } from "@playwright/test";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// Mirrors backend/api/settings.py::deep_merge: null removes a value.
const deepMerge = (base: Json, patch: Json): Json => {
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isObject(value)) {
      const nested = deepMerge(isObject(out[key]) ? (out[key] as Json) : {}, value);
      if (Object.keys(nested).length) out[key] = nested;
      else delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
};

/**
 * Serve /settings from an in-memory document. Register it after any catch-all
 * route: Playwright tries the most recently added route first.
 */
export async function mockSettingsApi(page: Page, initial: Json = {}) {
  const state = {
    document: initial,
    patches: [] as Json[],
    unavailable: null as string | null,
  };

  await page.route("**/settings", async (route) => {
    const request = route.request();
    if (state.unavailable) {
      await route.fulfill({ status: 503, json: { detail: state.unavailable } });
      return;
    }
    if (request.method() === "PATCH") {
      const patch = request.postDataJSON().settings as Json;
      state.patches.push(patch);
      state.document = deepMerge(state.document, patch);
    } else if (request.method() === "PUT") {
      state.document = request.postDataJSON().settings as Json;
    } else if (request.method() === "DELETE") {
      state.document = {};
    }
    await route.fulfill({ json: { settings: state.document, updatedAt: null } });
  });

  return state;
}
