import { defineConfig } from "vite";
import { silent } from "@ivlev-dev/silent-vite";
import { fileURLToPath } from "node:url";

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
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8080",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    target: "es2024",
    sourcemap: true,
  },
});
