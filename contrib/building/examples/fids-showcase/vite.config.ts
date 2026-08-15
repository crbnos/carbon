import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import type { PluginOption } from "vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5012,
    strictPort: true
  },
  resolve: {
    tsconfigPaths: true
  },
  ssr: {
    noExternal: ["react-icons", "tailwind-merge"]
  },
  plugins: [tailwindcss(), reactRouter()] as PluginOption[]
});
