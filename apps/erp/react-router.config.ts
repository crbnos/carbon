import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";


export default {
  ssr: true,
  presets: process.env.VERCEL ? [vercelPreset()] : undefined,
  future: { unstable_optimizeDeps: true, v8_middleware: true },
} satisfies Config;
