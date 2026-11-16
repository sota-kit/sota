# Sota — Pluggable AI Microkernel

A zero-AI-framework-dependency TypeScript microkernel (`@sota/core`) and plugin CLI (`@sota/cli`) built on Bun.

## Architecture

- **`packages/core` (`@sota/core`)**: Pure SPI contracts (`ModelSPI`, `EngineSPI`, `ToolSPI`, `MemorySPI`, `GuardSPI`, `TraceSPI`), standardized `AgentEvent` streaming, onion-model `RuntimeMiddleware`, `PluginRegistry`, and dynamic `SotaPlugin` loader. Only depends on `zod`.
- **`packages/cli` (`@sota/cli`)**: CLI (`sota init`, `sota add <plugin>`, `sota remove <plugin>`, `sota list`) to install and register external npm or local plugins without coupling them into this repo.
- **`examples/custom-plugin-demo`**: Minimal runnable demo showing how a standalone plugin plugs into `@sota/core`.

## Quick Start

```bash
bun install
bun test
bun run typecheck
bun run examples/custom-plugin-demo/index.ts
```
