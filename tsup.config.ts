import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // Declarations are bundled by tsup via the JS-based typescript@6 compiler
  // (the native typescript@7 has no Compiler API yet). typescript@6 is the
  // deprecation-bridge release, so silence its baseUrl-removal error here
  // rather than in the shared tsconfig (which the native @7 typecheck reads).
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
  target: 'node20',
});
