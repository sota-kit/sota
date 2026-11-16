import type { SotaConfig } from '@sota/core';

const config: SotaConfig = {
  plugins: ['./plugins/echo-plugin.ts'],
  defaults: {
    model: 'echo-model',
    engine: 'demo-engine',
  },
};

export default config;
