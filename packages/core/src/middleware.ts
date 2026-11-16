import type { RunContext } from './context.ts';
import type { AgentEvent } from './events.ts';

export interface ToolCallContext {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Onion-style middleware for cross-cutting concerns (auth, caching, rate-limiting, guardrails).
 */
export interface RuntimeMiddleware {
  readonly name: string;
  onRun?(
    ctx: RunContext,
    next: () => AsyncIterable<AgentEvent>,
  ): AsyncIterable<AgentEvent>;
  onToolCall?(
    call: ToolCallContext,
    ctx: RunContext,
    next: () => Promise<unknown>,
  ): Promise<unknown>;
}

/** Compose `onRun` middlewares around a terminal event stream producer. */
export function composeRunMiddlewares(
  middlewares: RuntimeMiddleware[],
  ctx: RunContext,
  terminal: () => AsyncIterable<AgentEvent>,
): AsyncIterable<AgentEvent> {
  const active = middlewares.filter((m) => typeof m.onRun === 'function');
  let index = -1;

  const dispatch = (i: number): AsyncIterable<AgentEvent> => {
    if (i <= index) {
      throw new Error('Middleware next() called multiple times');
    }
    index = i;
    const mw = active[i];
    if (!mw || !mw.onRun) {
      return terminal();
    }
    return mw.onRun(ctx, () => dispatch(i + 1));
  };

  return dispatch(0);
}

/** Compose `onToolCall` middlewares around a terminal tool execution function. */
export function composeToolMiddlewares(
  middlewares: RuntimeMiddleware[],
  call: ToolCallContext,
  ctx: RunContext,
  terminal: () => Promise<unknown>,
): Promise<unknown> {
  const active = middlewares.filter((m) => typeof m.onToolCall === 'function');
  let index = -1;

  const dispatch = (i: number): Promise<unknown> => {
    if (i <= index) {
      throw new Error('Middleware next() called multiple times');
    }
    index = i;
    const mw = active[i];
    if (!mw || !mw.onToolCall) {
      return terminal();
    }
    return mw.onToolCall(call, ctx, () => dispatch(i + 1));
  };

  return dispatch(0);
}
