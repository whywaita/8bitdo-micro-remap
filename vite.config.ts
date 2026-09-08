import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/8bitdo-micro-remap/" : "/",
  appType: "mpa",
  plugins: [
    react(),
    {
      name: "static-production-csp",
      apply: "build",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content:
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
            },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  ],
  server: { host: "127.0.0.1" },
  build: { sourcemap: false },
}));
