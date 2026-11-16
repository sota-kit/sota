import type { RunContext } from '../context.ts';
import type { AgentEvent } from '../events.ts';

export interface TraceRecord {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

/**
 * SPI for observability & telemetry exporters (e.g., OpenTelemetry, Langfuse, LangSmith, console).
 */
export interface TraceSPI {
  readonly id: string;
  onAgentEvent?(event: AgentEvent, ctx: RunContext): void;
  onSpan?(record: TraceRecord, ctx: RunContext): void;
  flush?(): Promise<void>;
}
