import type { RunContext } from '../context.ts';
import type { AgentEvent } from '../events.ts';
import type { PluginRegistry } from '../plugin.ts';
import type { MemorySPI } from './memory.ts';
import type { ChatMessage, ModelSPI } from './model.ts';
import type { ToolDefinition } from './tool.ts';

export interface EngineInput {
  input: string;
  systemPrompt?: string;
  history?: ChatMessage[];
}

export interface ToolExecutor {
  listTools(ctx: RunContext): Promise<ToolDefinition[]>;
  execute(name: string, args: Record<string, unknown>, ctx: RunContext): Promise<unknown>;
}

export interface EngineDeps {
  model: ModelSPI;
  tools: ToolExecutor;
  memory?: MemorySPI;
  /** Direct access to PluginRegistry so engines can resolve custom CapabilityTokens. */
  registry: PluginRegistry;
}

/**
 * SPI for orchestration engines (e.g., native loop, LangGraph adapter, Mastra adapter).
 */
export interface EngineSPI {
  readonly id: string;
  run(input: EngineInput, deps: EngineDeps, ctx: RunContext): AsyncIterable<AgentEvent>;
}
