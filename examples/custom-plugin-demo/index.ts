import { createRuntimeFromConfig } from '@sota/core';

const runtime = await createRuntimeFromConfig(undefined, import.meta.dir);

for await (const event of runtime.stream({ input: 'What time is it?' })) {
  console.log(event);
}
