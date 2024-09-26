import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
  },
  build: {
    sourcemap: true,
  },
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
    },
  },
});
