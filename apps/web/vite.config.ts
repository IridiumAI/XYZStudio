import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin /api in dev so auth cookies just work; SSE needs no buffering.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: false,
      },
    },
  },
});
