/**
 *  Central frontend backend URL configuration
 **/
// Defaults
const DEFAULT_HOST = "localhost";
const DEFAULT_PORT = "8000";

// Vite env: prefer a full URL override, otherwise build from host+port env vars.
// Supported env names (prefix with VITE_ in your .env files):
// - VITE_PROD_BACKEND_URL (e.g. "http://api.example.com:8000")
// - VITE_PROD_BACKEND_WS (e.g. "wss://api.example.com:443")
// - or VITE_PROD_BACKEND_HOST + VITE_PROD_BACKEND_PORT (defaults below)
const env = (import.meta as any).env as Record<string, any>;

const host = env.VITE_PROD_BACKEND_HOST ?? DEFAULT_HOST;
const port = env.VITE_PROD_BACKEND_PORT ?? DEFAULT_PORT;

export const PROD_BACKEND_URL =
  env.VITE_PROD_BACKEND_URL ?? `http://${host}:${port}`;

export const PROD_BACKEND_WS =
  env.VITE_PROD_BACKEND_WS ?? `ws://${host}:${port}`;
