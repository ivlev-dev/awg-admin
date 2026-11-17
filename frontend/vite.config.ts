import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";
import { fileURLToPath } from "node:url";

const apiTarget = process.env.VITE_API_PROXY ?? "http://127.0.0.1:8080";

const proxy = {
  "/api": {
    target: apiTarget,
    changeOrigin: true,
    ws: true,
  },
};

type SourcemapMode = boolean | "hidden";

function resolveSourcemap(raw: string | undefined): SourcemapMode {
  const value = (raw ?? "false").trim().toLowerCase();

  if (value === "" || value === "false" || value === "0" || value === "off") {
    return false;
  }

  if (value === "true" || value === "1" || value === "on") {
    return true;
  }

  if (value === "hidden") {
    return "hidden";
  }

  throw new Error(`VITE_SOURCEMAP must be one of true|false|hidden, got "${raw}"`);
}

const sourcemap = resolveSourcemap(process.env.VITE_SOURCEMAP);

export default defineConfig({
  plugins: [silent({ di: "error" })],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy,
  },
  build: {
    target: "es2024",
    sourcemap,
  },
});
