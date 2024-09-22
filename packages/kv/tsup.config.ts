import { defineConfig } from "tsup";

const isProduction = process.env.VERCEL_ENV === "production";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  minify: isProduction,
  sourcemap: true,
});
