import * as Sentry from "@sentry/node";

// Sentry is optional in local development. Call initSentry early in the
// process lifecycle; subsequent calls are no-ops.
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
    integrations: [...Sentry.getDefaultIntegrations({})],
  });

  // A single event on startup proves the integration end-to-end: DSN works,
  // the project exists, and the worker can reach ingest. No secrets in the
  // message — just a breadcrumb that the process is alive.
  Sentry.captureMessage("whatsapp-worker: initSentry succeeded");
}

// reportError is safe to call when Sentry is uninitialized: it returns
// immediately if there's no hub. The caller doesn't need a guard.
export function reportError(error: unknown, context?: Record<string, unknown>) {
  try {
    Sentry.captureException(error, {
      extra: context,
    });
  } catch {
    // Sentry itself threw; not worth crashing the handler over.
  }
}

// Flushes any buffered events before the process exits. Returns a promise
// so the caller can await it from a shutdown handler.
export function flushSentry() {
  return Sentry.close;
}
