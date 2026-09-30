import { sendClientLog } from "../services/diagnosticsAPI";

const HEARTBEAT_MS = 60_000;
const REPEAT_WINDOW_MS = 5_000;

type ChromeMemory = { usedJSHeapSize: number; totalJSHeapSize: number };

let installed = false;
const recent = new Map<string, number>();

/** Log a page error once per few seconds, however often it repeats. */
export function reportClientError(message: string, stack?: string, source?: string): void {
  const now = Date.now();
  for (const [key, time] of recent) {
    if (now - time > REPEAT_WINDOW_MS) recent.delete(key);
  }
  if (recent.has(message)) return;
  recent.set(message, now);
  void sendClientLog({ level: "error", message, stack, source });
}

const errorText = (reason: unknown): { message: string; stack?: string } =>
  reason instanceof Error
    ? { message: `${reason.name}: ${reason.message}`, stack: reason.stack }
    : { message: String(reason) };

/**
 * Send uncaught page errors to the app log, plus the JS heap size once a
 * minute where the WebView reports it (Chromium/WebView2 only).
 */
export function installClientLog(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const { message, stack } = event.error ? errorText(event.error) : { message: event.message };
    const where = event.filename ? `${event.filename}:${event.lineno}` : undefined;
    reportClientError(message, stack, where);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const { message, stack } = errorText(event.reason);
    reportClientError(`Unhandled rejection: ${message}`, stack);
  });

  const readMemory = () => (performance as Performance & { memory?: ChromeMemory }).memory;
  if (readMemory()) {
    window.setInterval(() => {
      const memory = readMemory();
      if (!memory) return;
      void sendClientLog({
        level: "info",
        heap_used: memory.usedJSHeapSize,
        heap_total: memory.totalJSHeapSize,
      });
    }, HEARTBEAT_MS);
  }
}
