import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const evidenceFiles = [
  "moderate-drift-deep-toy.json",
  "large-target-change.json",
  "stale-oracle.json",
] as const;

function evidencePlugin() {
  return {
    name: "setpoint-evidence",
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: Uint8Array | string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        const fileName = request.url?.split("?")[0]?.replace("/evidence/", "");
        if (fileName === undefined || !evidenceFiles.includes(fileName as (typeof evidenceFiles)[number])) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(readFileSync(resolve("artifacts/hybrid", fileName)));
      });
    },
    generateBundle(this: { emitFile: (asset: { type: "asset"; fileName: string; source: Uint8Array }) => void }) {
      for (const fileName of evidenceFiles) {
        this.emitFile({
          type: "asset",
          fileName: `evidence/${fileName}`,
          source: readFileSync(resolve("artifacts/hybrid", fileName)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), evidencePlugin()],
  publicDir: false,
  build: {
    outDir: "dist/operator-console",
    emptyOutDir: true,
    sourcemap: true,
  },
});
