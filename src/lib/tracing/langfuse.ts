import { Langfuse } from "langfuse";

// Lazy-init so tests that never set the env vars never construct a client
// (the SDK logs a noisy warning otherwise). LANGFUSE_HOST defaults to
// cloud.langfuse.com; a self-hosted install sets it to its own URL.
export type LangfuseConfig = {
  publicKey: string;
  secretKey: string;
  host?: string;
};

let singleton: Langfuse | null = null;
let initialized = false;

export function createLangfuseClient(config: LangfuseConfig): Langfuse {
  if (singleton && initialized) return singleton;
  singleton = new Langfuse({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    ...(config.host ? { baseUrl: config.host } : {}),
  });
  initialized = true;
  return singleton;
}

// Wrapped so callers don't have to know whether the env vars were set: in
// dev and in tests the client is a no-op. Returns null so the trace context
// can be propagated as `null` and consumers know to skip persisting a
// langfuse_trace_id.
export function tryCreateLangfuseClient(): Langfuse | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  return createLangfuseClient({
    publicKey,
    secretKey,
    ...(process.env.LANGFUSE_HOST ? { host: process.env.LANGFUSE_HOST } : {}),
  });
}

// Returns the existing singleton if initialized, otherwise null. Used by the
// worker to flush pending spans at SIGTERM.
export function getLangfuseClient(): Langfuse | null {
  return initialized ? singleton : null;
}

export async function shutdownLangfuse(): Promise<void> {
  if (!initialized || !singleton) return;
  await singleton.shutdownAsync();
  singleton = null;
  initialized = false;
}

// TracingContext is the minimal handle a worker-level caller needs: when
// langfuse is disabled every method becomes a no-op so the call site stays
// unconditional.
export type TracingContext = {
  langfuse: Langfuse | null;
  traceId: string | null;
};

export function startTrace(input: {
  name: string;
  langfuse: Langfuse | null;
  metadata?: Record<string, unknown>;
}): TracingContext {
  if (!input.langfuse) return { langfuse: null, traceId: null };
  const trace = input.langfuse.trace({
    name: input.name,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  return { langfuse: input.langfuse, traceId: trace.id };
}

export type NoopSpan = {
  end(): void;
  update(input: Record<string, unknown>): void;
};

// Records a span representing a unit of work. We track it manually rather
// than using the auto-instrumented observeOpenAI wrapper because the LLM
// modules return Zod-validated objects, and post-processing them inside
// span.update would couple the LLM layer to tracing. Keeping it at the
// worker level means the LLM modules stay pure.
export function startSpan(input: {
  ctx: TracingContext;
  name: string;
  metadata?: Record<string, unknown>;
}): NoopSpan {
  if (!input.ctx.langfuse || !input.ctx.traceId) {
    return { end: () => {}, update: () => {} };
  }
  const span = input.ctx.langfuse.span({
    traceId: input.ctx.traceId,
    name: input.name,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  return {
    end: () => span.end(),
    update: (meta) => span.update({ metadata: meta }),
  };
}

export type LlmUsage = {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

// Records one LLM generation event with token counts and latency. Used
// after the call completes so we have the actual token counts from the
// provider response.
export function recordLlmGeneration(input: {
  ctx: TracingContext;
  name: string;
  usage: LlmUsage;
  startTime: Date;
  endTime: Date;
  input: unknown;
  output: unknown;
  metadata?: Record<string, unknown>;
}): void {
  if (!input.ctx.langfuse || !input.ctx.traceId) return;
  input.ctx.langfuse.generation({
    traceId: input.ctx.traceId,
    name: input.name,
    model: input.usage.model,
    input: input.input,
    output: input.output,
    startTime: input.startTime,
    endTime: input.endTime,
    usage: {
      input: input.usage.inputTokens ?? 0,
      output: input.usage.outputTokens ?? 0,
      total: (input.usage.inputTokens ?? 0) + (input.usage.outputTokens ?? 0),
      unit: "TOKENS",
    },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}
