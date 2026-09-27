import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const evidenceFiles = [
  "moderate-drift-deep-toy.json",
  "large-target-change.json",
  "stale-oracle.json",
] as const;

const securityEvidenceFiles = [
  "malicious-target.json",
  "stale-oracle.json",
  "unknown-revert.json",
  "unsafe-liquidity.json",
  "unsupported-route.json",
] as const;
const summaryFile = "m4-2-summary.json";

function evidencePlugin() {
  return {
    name: "setpoint-evidence",
    configureServer(server: { middlewares: { use: (handler: (request: { url?: string }, response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: Uint8Array | string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((request, response, next) => {
        const requestPath = request.url?.split("?")[0];
        if (requestPath === `/evidence/${summaryFile}`) {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(resolve("artifacts", summaryFile)));
          return;
        }
        const securityFileName = requestPath?.replace("/evidence/security/", "");
        if (requestPath?.startsWith("/evidence/security/") && securityFileName !== undefined && securityEvidenceFiles.includes(securityFileName as (typeof securityEvidenceFiles)[number])) {
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(readFileSync(resolve("artifacts/security", securityFileName)));
          return;
        }
        const fileName = requestPath?.replace("/evidence/", "");
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
      this.emitFile({
        type: "asset",
        fileName: `evidence/${summaryFile}`,
        source: readFileSync(resolve("artifacts", summaryFile)),
      });
      for (const fileName of evidenceFiles) {
        this.emitFile({
          type: "asset",
          fileName: `evidence/${fileName}`,
          source: readFileSync(resolve("artifacts/hybrid", fileName)),
        });
      }
      for (const fileName of securityEvidenceFiles) {
        this.emitFile({
          type: "asset",
          fileName: `evidence/security/${fileName}`,
          source: readFileSync(resolve("artifacts/security", fileName)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), evidencePlugin()],
  publicDir: "web/public",
  server: {
    proxy: {
      "/rpc/mainnet": {
        target: "https://rpc.mainnet.chain.robinhood.com",
        changeOrigin: true,
        rewrite: () => "/",
      },
      "/rpc/testnet": {
        target: "https://rpc.testnet.chain.robinhood.com",
        changeOrigin: true,
        rewrite: () => "/",
      },
    },
  },
  build: {
    outDir: "dist/operator-console",
    emptyOutDir: true,
    sourcemap: false,
  },
});
