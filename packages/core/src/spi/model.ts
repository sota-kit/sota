import type { RunContext } from '../context.ts';
import type { TokenUsage } from '../events.ts';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
}

export interface ModelToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  messages: ChatMessage[];
  tools?: ModelToolSpec[];
  temperature?: number;
  maxTokens?: number;
  /** Optional provider-specific overrides. */
  extra?: Record<string, unknown>;
}

export type ModelChunk =
  | { type: 'text.delta'; content: string }
  | { type: 'thought.delta'; content: string }
  | {
      type: 'tool.call';
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'done'; finishReason: 'stop' | 'length' | 'tool_calls' };

/**
 * SPI for LLM providers / gateways (e.g., OpenAI-compatible, Anthropic, Gemini, LiteLLM).
 */
export interface ModelSPI {
  readonly id: string;
  stream(req: ModelRequest, ctx: RunContext): AsyncIterable<ModelChunk>;
  embed?(texts: string[], ctx: RunContext): Promise<number[][]>;
}
