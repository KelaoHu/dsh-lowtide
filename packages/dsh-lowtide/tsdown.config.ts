import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('dsh-lowtide', ['src/index.ts'], {
  lib: {
    // All @deepseek-ai/* packages share runtime identity with the host
    // process (cordis services, zod instances, brand factories) — never
    // bundle them into the host half. lowtide-core and zod are devDeps
    // and inline by default.
    deps: {
      neverBundle: [/^@deepseek-ai\//],
    },
  },
})
