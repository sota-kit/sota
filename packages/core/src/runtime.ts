import {
  EngineCapability,
  GuardCapability,
  MemoryCapability,
  MiddlewareCapability,
  ModelCapability,
  ToolCapability,
  TraceCapability,
} from './capability.ts';
import { createRunContext, type CreateRunContextOptions, type RunContext } from './context.ts';
import type { AgentEvent } from './events.ts';
import { loadConfig, loadPlugins, type SotaConfig } from './loader.ts';
import {
  composeRunMiddlewares,
  composeToolMiddlewares,
} from './middleware.ts';
import { PluginRegistry } from './plugin.ts';
import type {
  EngineInput,
  EngineSPI,
  MemorySPI,
  ModelSPI,
  ToolDefinition,
  ToolExecutor,
} from './spi/index.ts';

export interface RuntimeOptions {
  registry?: PluginRegistry;
  model?: string | ModelSPI;
  engine?: string | EngineSPI;
  memory?: string | MemorySPI;
}

export interface StreamOptions extends CreateRunContextOptions {
  model?: string | ModelSPI;
  engine?: string | EngineSPI;
  memory?: string | MemorySPI;
}

/**
 * Core runtime orchestrating lifecycle hooks, capability resolution,
 * middlewares, guards, tool routing, tracing, and the selected EngineSPI.
 */
export class AgentRuntime {
  readonly registry: PluginRegistry;
  private readonly defaultModel?: string | ModelSPI;
  private readonly defaultEngine?: string | EngineSPI;
  private readonly defaultMemory?: string | MemorySPI;

  constructor(options: RuntimeOptions = {}) {
    this.registry = options.registry ?? new PluginRegistry();
    this.defaultModel = options.model;
    this.defaultEngine = options.engine;
    this.defaultMemory = options.memory;
  }

  /** Start long-lived plugins (e.g., UI servers, IM bots, queue consumers). */
  async start(): Promise<void> {
    for (const hook of this.registry.getStartHooks()) {
      await hook(this);
    }
  }

  /** Gracefully stop long-lived plugins and flush tracers. */
  async stop(): Promise<void> {
    for (const hook of this.registry.getStopHooks()) {
      await hook();
    }
    await Promise.all(
      this.registry.resolveAll(TraceCapability).map((t) => t.flush?.()),
    );
  }

  private resolveModel(override?: string | ModelSPI): ModelSPI {
    const target = override ?? this.defaultModel;
    if (!target) {
      const first = this.registry.resolve(ModelCapability);
      if (!first) throw new Error('No ModelSPI provided in PluginRegistry.');
      return first;
    }
    if (typeof target !== 'string') return target;
    const found = this.registry.resolve(ModelCapability, target);
    if (!found) {
      throw new Error(`ModelSPI "${target}" is not registered.`);
    }
    return found;
  }

  private resolveEngine(override?: string | EngineSPI): EngineSPI {
    const target = override ?? this.defaultEngine;
    if (!target) {
      const first = this.registry.resolve(EngineCapability);
      if (!first) throw new Error('No EngineSPI provided in PluginRegistry.');
      return first;
    }
    if (typeof target !== 'string') return target;
    const found = this.registry.resolve(EngineCapability, target);
    if (!found) {
      throw new Error(`EngineSPI "${target}" is not registered.`);
    }
    return found;
  }

  private resolveMemory(override?: string | MemorySPI): MemorySPI | undefined {
    const target = override ?? this.defaultMemory;
    if (!target) {
      return this.registry.resolve(MemoryCapability);
    }
    if (typeof target !== 'string') return target;
    const found = this.registry.resolve(MemoryCapability, target);
    if (!found) {
      throw new Error(`MemorySPI "${target}" is not registered.`);
    }
    return found;
  }

  private createToolExecutor(): ToolExecutor {
    const providers = this.registry.resolveAll(ToolCapability);
    const middlewares = this.registry.resolveAll(MiddlewareCapability);
    const guards = this.registry.resolveAll(GuardCapability);

    return {
      async listTools(ctx: RunContext): Promise<ToolDefinition[]> {
        const lists = await Promise.all(providers.map((p) => p.listTools(ctx)));
        return lists.flat();
      },
      async execute(
        name: string,
        args: Record<string, unknown>,
        ctx: RunContext,
      ): Promise<unknown> {
        for (const guard of guards) {
          if (!guard.checkToolCall) continue;
          const decision = await guard.checkToolCall(name, args, ctx);
          if (decision.action === 'block') {
            throw new Error(`Tool "${name}" blocked by guard "${guard.id}": ${decision.reason}`);
          }
          if (decision.action === 'require_approval') {
            throw new Error(`Tool "${name}" requires approval: ${decision.reason}`);
          }
        }

        const callId = crypto.randomUUID();
        return composeToolMiddlewares(
          middlewares,
          { callId, toolName: name, args },
          ctx,
          async () => {
            for (const provider of providers) {
              const tools = await provider.listTools(ctx);
              if (tools.some((t) => t.name === name)) {
                return provider.execute(name, args, ctx);
              }
            }
            throw new Error(`Tool "${name}" not found in any registered ToolSPI.`);
          },
        );
      },
    };
  }

  private emitTrace(event: AgentEvent, ctx: RunContext): void {
    for (const tracer of this.registry.resolveAll(TraceCapability)) {
      tracer.onAgentEvent?.(event, ctx);
    }
  }

  /** Execute an agent run and stream standardized AgentEvents. */
  async *stream(
    input: EngineInput,
    options: StreamOptions = {},
  ): AsyncIterable<AgentEvent> {
    const ctx = createRunContext(options);
    const model = this.resolveModel(options.model);
    const engine = this.resolveEngine(options.engine);
    const memory = this.resolveMemory(options.memory);
    const tools = this.createToolExecutor();
    const guards = this.registry.resolveAll(GuardCapability);
    const middlewares = this.registry.resolveAll(MiddlewareCapability);

    let effectiveInput = input.input;
    for (const guard of guards) {
      if (!guard.checkInput) continue;
      const decision = await guard.checkInput(effectiveInput, ctx);
      if (decision.action === 'block') {
        const errEvent: AgentEvent = {
          type: 'run.error',
          error: new Error(`Input blocked by guard "${guard.id}": ${decision.reason}`),
        };
        this.emitTrace(errEvent, ctx);
        yield errEvent;
        return;
      }
      if (decision.action === 'redact') {
        effectiveInput = decision.content;
      }
    }

    const startEvent: AgentEvent = {
      type: 'run.start',
      runId: ctx.runId,
      timestamp: Date.now(),
    };
    this.emitTrace(startEvent, ctx);
    yield startEvent;

    const eventStream = composeRunMiddlewares(middlewares, ctx, () =>
      engine.run(
        { ...input, input: effectiveInput },
        { model, tools, memory, registry: this.registry },
        ctx,
      ),
    );

    try {
      for await (const event of eventStream) {
        this.emitTrace(event, ctx);
        yield event;
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errEvent: AgentEvent = { type: 'run.error', error };
      this.emitTrace(errEvent, ctx);
      yield errEvent;
    } finally {
      await Promise.all(
        this.registry.resolveAll(TraceCapability).map((t) => t.flush?.()),
      );
    }
  }
}

export function createRuntime(options: RuntimeOptions = {}): AgentRuntime {
  return new AgentRuntime(options);
}

/** Build an AgentRuntime directly from a SotaConfig or `sota.config.ts` in `cwd`. */
export async function createRuntimeFromConfig(
  configOrPath?: SotaConfig | string,
  cwd = process.cwd(),
): Promise<AgentRuntime> {
  const config =
    typeof configOrPath === 'object'
      ? configOrPath
      : await loadConfig(configOrPath, cwd);

  const registry = await loadPlugins(config.plugins, new PluginRegistry(), cwd);
  return new AgentRuntime({
    registry,
    model: config.defaults?.model,
    engine: config.defaults?.engine,
    memory: config.defaults?.memory,
  });
}
