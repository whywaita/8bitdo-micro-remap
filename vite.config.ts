import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: { host: "127.0.0.1" },
  build: { sourcemap: false },
});
