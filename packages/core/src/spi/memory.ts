import type { RunContext } from '../context.ts';
import type { ChatMessage } from './model.ts';

export interface MemoryItem {
  id: string;
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/**
 * SPI for long-term memory & RAG backends (e.g., Mem0, Zep, LlamaIndex, pgvector).
 */
export interface MemorySPI {
  readonly id: string;
  retrieve(query: string, ctx: RunContext, limit?: number): Promise<MemoryItem[]>;
  memorize(messages: ChatMessage[], ctx: RunContext): Promise<void>;
}
