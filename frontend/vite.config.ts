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

export default defineConfig({
  plugins: [silent()],
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
    sourcemap: true,
  },
});
