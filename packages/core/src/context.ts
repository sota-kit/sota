/**
 * Request-scoped execution context propagated through the kernel, middlewares,
 * and every SPI plugin.
 */
export interface RunContext {
  readonly runId: string;
  readonly traceId: string;
  readonly sessionId?: string;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly signal: AbortSignal;
  /** Shared mutable state bag for middlewares and plugins within a single run. */
  readonly state: Map<string, unknown>;
  /** Escape hatch for passing plugin- or engine-specific options without polluting core types. */
  readonly extensions: Record<string, unknown>;
}

export interface CreateRunContextOptions {
  runId?: string;
  traceId?: string;
  sessionId?: string;
  userId?: string;
  tenantId?: string;
  signal?: AbortSignal;
  extensions?: Record<string, unknown>;
}

/** Create a new RunContext with sensible defaults. */
export function createRunContext(options: CreateRunContextOptions = {}): RunContext {
  return {
    runId: options.runId ?? crypto.randomUUID(),
    traceId: options.traceId ?? crypto.randomUUID(),
    sessionId: options.sessionId,
    userId: options.userId,
    tenantId: options.tenantId,
    signal: options.signal ?? new AbortController().signal,
    state: new Map<string, unknown>(),
    extensions: options.extensions ?? {},
  };
}
