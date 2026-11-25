import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "es2022",
  platform: "node",
  clean: true,
  sourcemap: true,
  // The engine is plain TypeScript source in this monorepo, so bundle it in.
  noExternal: ["@tilt/engine"],
});
