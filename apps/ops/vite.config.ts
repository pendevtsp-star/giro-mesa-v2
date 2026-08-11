import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const pwaHeaders: Plugin = {
  name: "giromesa-pwa-headers",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split("?", 1)[0];
      if (pathname?.startsWith("/assets/") || pathname?.startsWith("/icons/")) {
        response.setHeader("Cache-Control", "public, max-age=604800");
      }
      if (pathname === "/sw.js" || pathname === "/pwa-cache-policy.js") {
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
      if (pathname === "/sw.js") {
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'");
      }
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split("?", 1)[0];
      if (pathname?.startsWith("/assets/") || pathname?.startsWith("/icons/")) {
        response.setHeader("Cache-Control", "public, max-age=604800");
      }
      if (pathname === "/sw.js" || pathname === "/pwa-cache-policy.js") {
        response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
      if (pathname === "/sw.js") {
        response.setHeader("Content-Type", "application/javascript; charset=utf-8");
        response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'");
      }
      next();
    });
  },
};

export default defineConfig({
  base: "./",
  plugins: [react(), pwaHeaders],
  build: {
    target: "es2022",
  },
  test: {
    environment: "node",
  },
});
