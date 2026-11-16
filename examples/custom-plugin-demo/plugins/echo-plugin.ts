import { z } from 'zod';
import {
  definePlugin,
  EngineCapability,
  ModelCapability,
  ToolCapability,
  zodToJsonSchema,
  type AgentEvent,
  type EngineSPI,
  type ModelSPI,
  type ToolSPI,
} from '@sota/core';

/**
 * Minimal self-contained example plugin demonstrating how any external or local
 * package can plug into @sota/core via CapabilityTokens without core knowing anything about it.
 */
export default definePlugin({
  name: 'echo-demo-plugin',
  version: '0.1.0',
  setup(registry) {
    const model: ModelSPI = {
      id: 'echo-model',
      async *stream(req) {
        const last = req.messages[req.messages.length - 1]?.content ?? '';
        yield { type: 'text.delta', content: `[echo-model] ${last}` };
        yield { type: 'done', finishReason: 'stop' };
      },
    };

    const toolProvider: ToolSPI = {
      id: 'demo-tools',
      async listTools() {
        return [
          {
            name: 'get_time',
            description: 'Return current ISO timestamp',
            inputSchema: z.object({ tz: z.string().optional() }),
          },
        ];
      },
      async execute(name, args) {
        if (name === 'get_time') {
          return { iso: new Date().toISOString(), tz: args.tz ?? 'UTC' };
        }
        throw new Error(`Unknown tool: ${name}`);
      },
    };

    const engine: EngineSPI = {
      id: 'demo-engine',
      async *run(input, deps, ctx): AsyncIterable<AgentEvent> {
        const tools = await deps.tools.listTools(ctx);
        const toolSpecs = tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.jsonSchema ?? zodToJsonSchema(t.inputSchema),
        }));

        if (input.input.includes('time') && tools.some((t) => t.name === 'get_time')) {
          const callId = crypto.randomUUID();
          yield { type: 'tool.call', callId, toolName: 'get_time', args: { tz: 'Asia/Shanghai' } };
          const result = await deps.tools.execute('get_time', { tz: 'Asia/Shanghai' }, ctx);
          yield { type: 'tool.result', callId, toolName: 'get_time', result };
        }

        for await (const chunk of deps.model.stream(
          {
            messages: [{ role: 'user', content: input.input }],
            tools: toolSpecs,
          },
          ctx,
        )) {
          if (chunk.type === 'text.delta') {
            yield { type: 'text.delta', content: chunk.content };
          }
        }

        yield { type: 'run.done', finishReason: 'stop' };
      },
    };

    registry
      .provide(ModelCapability, 'echo-model', model)
      .provide(ToolCapability, 'demo-tools', toolProvider)
      .provide(EngineCapability, 'demo-engine', engine);
  },
});
