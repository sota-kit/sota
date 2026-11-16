export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export type FinishReason = 'stop' | 'length' | 'error' | 'paused' | 'cancelled';

/**
 * Standardized streaming event union emitted by any EngineSPI and consumed by
 * applications, UIs, and tracers.
 */
export type AgentEvent =
  | { type: 'run.start'; runId: string; timestamp: number }
  | { type: 'thought.delta'; content: string }
  | { type: 'text.delta'; content: string }
  | {
      type: 'tool.call';
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool.result';
      callId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    }
  | {
      type: 'approval.required';
      actionId: string;
      toolName: string;
      args: Record<string, unknown>;
      reason: string;
    }
  | { type: 'run.done'; usage?: TokenUsage; finishReason: FinishReason }
  | { type: 'run.error'; error: Error };
