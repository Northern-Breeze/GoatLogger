import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "platforms/browser": "src/platforms/browser.ts" },
    format: ["esm"],
    dts: true,
    treeshake: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    outDir: "dist",
  },
  {
    entry: { "platforms/node": "src/platforms/node.ts" },
    format: ["esm"],
    dts: true,
    treeshake: true,
    sourcemap: true,
    splitting: false,
    outDir: "dist",
    external: ["ws"],
  },
  {
    entry: { "platforms/node": "src/platforms/node.ts" },
    format: ["cjs"],
    dts: true,
    treeshake: true,
    sourcemap: true,
    splitting: false,
    outDir: "dist",
    external: ["ws"],
  },
]);
