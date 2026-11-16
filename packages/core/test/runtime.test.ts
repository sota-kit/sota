import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  createRuntime,
  createRuntimeFromConfig,
  defineCapability,
  definePlugin,
  EngineCapability,
  GuardCapability,
  MiddlewareCapability,
  ModelCapability,
  PluginRegistry,
  ToolCapability,
  TraceCapability,
  zodToJsonSchema,
  type AgentEvent,
  type EngineSPI,
  type GuardSPI,
  type ModelSPI,
  type RuntimeMiddleware,
  type ToolSPI,
  type TraceSPI,
} from '../src/index.ts';

function makeEchoModel(): ModelSPI {
  return {
    id: 'mock-model',
    async *stream(req) {
      const content = req.messages[req.messages.length - 1]?.content ?? '';
      yield { type: 'text.delta', content: `reply:${content}` };
      yield { type: 'done', finishReason: 'stop' };
    },
  };
}

function makeSimpleEngine(): EngineSPI {
  return {
    id: 'mock-engine',
    async *run(input, deps, ctx): AsyncIterable<AgentEvent> {
      const tools = await deps.tools.listTools(ctx);
      if (tools.length > 0 && input.input.includes('use-tool')) {
        const result = await deps.tools.execute(tools[0]!.name, { value: 42 }, ctx);
        yield {
          type: 'tool.result',
          callId: 'c1',
          toolName: tools[0]!.name,
          result,
        };
      }
      for await (const chunk of deps.model.stream(
        { messages: [{ role: 'user', content: input.input }] },
        ctx,
      )) {
        if (chunk.type === 'text.delta') {
          yield { type: 'text.delta', content: chunk.content };
        }
      }
      yield { type: 'run.done', finishReason: 'stop' };
    },
  };
}

describe('@sota/core', () => {
  test('zodToJsonSchema converts object and primitive schemas', () => {
    const schema = z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional(),
      tags: z.array(z.string()),
    });
    const json = zodToJsonSchema(schema);
    expect(json).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['query', 'tags'],
    });
  });

  test('streams events through capability-registered plugins, middlewares, tools, and tracers', async () => {
    const traced: string[] = [];
    const mwOrder: string[] = [];

    const tracer: TraceSPI = {
      id: 'mem-tracer',
      onAgentEvent(event) {
        traced.push(event.type);
      },
    };

    const toolProvider: ToolSPI = {
      id: 'math-tools',
      async listTools() {
        return [
          {
            name: 'double',
            description: 'Doubles a number',
            inputSchema: z.object({ value: z.number() }),
          },
        ];
      },
      async execute(name, args) {
        if (name === 'double') return Number(args.value) * 2;
        throw new Error(`Unknown tool: ${name}`);
      },
    };

    const middleware: RuntimeMiddleware = {
      name: 'audit-mw',
      async *onRun(_ctx, next) {
        mwOrder.push('run:before');
        yield* next();
        mwOrder.push('run:after');
      },
      async onToolCall(call, _ctx, next) {
        mwOrder.push(`tool:before:${call.toolName}`);
        const res = await next();
        mwOrder.push(`tool:after:${call.toolName}`);
        return res;
      },
    };

    const registry = new PluginRegistry()
      .provide(ModelCapability, 'mock-model', makeEchoModel())
      .provide(EngineCapability, 'mock-engine', makeSimpleEngine())
      .provide(ToolCapability, 'math-tools', toolProvider)
      .add(MiddlewareCapability, middleware)
      .add(TraceCapability, tracer);

    const runtime = createRuntime({ registry });
    const events: AgentEvent[] = [];
    for await (const ev of runtime.stream({ input: 'please use-tool' })) {
      events.push(ev);
    }

    expect(events.map((e) => e.type)).toEqual([
      'run.start',
      'tool.result',
      'text.delta',
      'run.done',
    ]);
    const toolEv = events.find((e) => e.type === 'tool.result');
    expect(toolEv && toolEv.type === 'tool.result' ? toolEv.result : null).toBe(84);
    expect(traced).toEqual(['run.start', 'tool.result', 'text.delta', 'run.done']);
    expect(mwOrder).toEqual([
      'run:before',
      'tool:before:double',
      'tool:after:double',
      'run:after',
    ]);
  });

  test('GuardCapability can redact or block input', async () => {
    const guard: GuardSPI = {
      id: 'pii-guard',
      async checkInput(input) {
        if (input.includes('forbidden')) {
          return { action: 'block', reason: 'policy violation' };
        }
        if (input.includes('secret')) {
          return { action: 'redact', content: input.replace('secret', '[REDACTED]') };
        }
        return { action: 'allow' };
      },
    };

    const registry = new PluginRegistry()
      .provide(ModelCapability, 'm', makeEchoModel())
      .provide(EngineCapability, 'e', makeSimpleEngine())
      .add(GuardCapability, guard);

    const runtime = createRuntime({ registry });

    const blocked: AgentEvent[] = [];
    for await (const ev of runtime.stream({ input: 'forbidden request' })) {
      blocked.push(ev);
    }
    expect(blocked[0]?.type).toBe('run.error');

    const redacted: AgentEvent[] = [];
    for await (const ev of runtime.stream({ input: 'my secret key' })) {
      redacted.push(ev);
    }
    const textEv = redacted.find((e) => e.type === 'text.delta');
    expect(textEv && textEv.type === 'text.delta' ? textEv.content : '').toBe(
      'reply:my [REDACTED] key',
    );
  });

  test('supports user-defined custom CapabilityTokens and start/stop lifecycle hooks without touching core', async () => {
    interface SandboxSPI {
      evalCode(code: string): Promise<string>;
    }
    const SandboxCapability = defineCapability<SandboxSPI>('userland.sandbox');

    const lifecycleLog: string[] = [];

    const sandboxPlugin = definePlugin({
      name: 'custom-sandbox-plugin',
      version: '0.1.0',
      setup(registry) {
        registry.provide(SandboxCapability, 'local', {
          async evalCode(code) {
            return `executed:${code}`;
          },
        });
        registry
          .onStart(async (runtime) => {
            lifecycleLog.push(`started:${runtime.registry.listKeys(SandboxCapability).join(',')}`);
          })
          .onStop(async () => {
            lifecycleLog.push('stopped');
          });
      },
    });

    const enginePlugin = definePlugin({
      name: 'custom-engine-plugin',
      version: '0.1.0',
      setup(registry) {
        registry.provide(ModelCapability, 'm1', makeEchoModel());
        registry.provide(EngineCapability, 'e1', {
          id: 'e1',
          async *run(input, deps) {
            const sandbox = deps.registry.resolve(SandboxCapability, 'local');
            const out = await sandbox!.evalCode(input.input);
            yield { type: 'text.delta', content: out };
            yield { type: 'run.done', finishReason: 'stop' };
          },
        });
      },
    });

    const runtime = await createRuntimeFromConfig({
      plugins: [sandboxPlugin, enginePlugin],
      defaults: { model: 'm1', engine: 'e1' },
    });

    await runtime.start();

    const events: AgentEvent[] = [];
    for await (const ev of runtime.stream({ input: '1+1' })) {
      events.push(ev);
    }
    await runtime.stop();

    const textEv = events.find((e) => e.type === 'text.delta');
    expect(textEv && textEv.type === 'text.delta' ? textEv.content : '').toBe('executed:1+1');
    expect(lifecycleLog).toEqual(['started:local', 'stopped']);
  });
});
