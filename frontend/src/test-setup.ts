import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount between tests: React Testing Library renders into a shared document,
// so a component left mounted leaks into the next test's queries.
afterEach(() => {
  cleanup();
});

// jsdom ships a localStorage, but a store persisted in one test would then be
// read back in another. Reset it rather than sharing state across tests.
afterEach(() => {
  localStorage.clear();
});
