/**
 *  Central frontend backend URL configuration
 **/
// Defaults
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = "8000";

// Vite env: prefer a full URL override, otherwise build from host+port env vars.
// Additionally support a runtime-injected global `window.__QIMCHI_RUNTIME__`
// which is written by the container entrypoint at startup. Precedence:
// 1. runtime global
// 2. Vite build-time env (import.meta.env)
// 3. defaults
const env = (import.meta as any).env as Record<string, any>;

// runtime config, if any (injected by /runtime-config.js at container start)
const runtime = (globalThis as any).__QIMCHI_RUNTIME__ as
  | Record<string, any>
  | undefined;

const host =
  runtime?.PROD_BACKEND_HOST ?? env.VITE_PROD_BACKEND_HOST ?? DEFAULT_HOST;
const port =
  runtime?.PROD_BACKEND_PORT ?? env.VITE_PROD_BACKEND_PORT ?? DEFAULT_PORT;

export const PROD_BACKEND_URL =
  runtime?.PROD_BACKEND_URL ??
  env.VITE_PROD_BACKEND_URL ??
  `http://${host}:${port}`;

export const PROD_BACKEND_WS =
  runtime?.PROD_BACKEND_WS ??
  env.VITE_PROD_BACKEND_WS ??
  `ws://${host}:${port}`;
console.log("Using backend URL:", PROD_BACKEND_URL, PROD_BACKEND_WS);
