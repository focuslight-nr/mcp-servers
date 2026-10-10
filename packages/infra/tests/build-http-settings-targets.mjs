import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['packages/infra/tests/http-settings-targets.ts'],
  outfile: 'packages/infra/dist/http-settings-targets.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  alias: {
    '@chkp/quantum-infra': `${root}packages/infra/src/index.ts`,
    '@chkp/mcp-utils': `${root}packages/mcp-utils/src/index.ts`,
  },
});
