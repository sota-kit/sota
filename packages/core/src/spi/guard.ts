import type { RunContext } from '../context.ts';

export type GuardDecision =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'redact'; content: string }
  | { action: 'require_approval'; reason: string };

/**
 * SPI for input/output/tool-call guardrails and Human-in-the-Loop (HITL) policies.
 */
export interface GuardSPI {
  readonly id: string;
  checkInput?(input: string, ctx: RunContext): Promise<GuardDecision>;
  checkToolCall?(
    toolName: string,
    args: Record<string, unknown>,
    ctx: RunContext,
  ): Promise<GuardDecision>;
  checkOutput?(output: string, ctx: RunContext): Promise<GuardDecision>;
}
