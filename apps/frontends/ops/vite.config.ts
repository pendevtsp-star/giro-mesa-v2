import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: ({ name }) => `assets/${name.replaceAll(".", "-")}-[hash].js`,
      },
    },
    target: "es2022",
  },
  test: {
    environment: "node",
  },
});
