import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The website uses the engine straight from source, so a deploy that builds only this folder
  // (for example on Vercel) does not depend on how npm links workspace packages.
  resolve: {
    alias: { "@tilt/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)) },
  },
  server: { host: true, port: 5173 },
  build: { target: "es2022", chunkSizeWarningLimit: 700 },
});
