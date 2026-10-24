import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.API_URL || "http://localhost:8000", changeOrigin: true },
      "/docs": { target: process.env.API_URL || "http://localhost:8000", changeOrigin: true },
      "/openapi.json": { target: process.env.API_URL || "http://localhost:8000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
