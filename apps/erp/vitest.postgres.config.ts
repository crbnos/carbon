import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["app/**/*.postgres.test.ts"],
    exclude: configDefaults.exclude,
    passWithNoTests: false,
    // Keep imports usable until the harness has validated and installed the
    // real local PostgreSQL URL in beforeAll.
    env: {
      INNGEST_SIGNING_KEY: "test",
      INNGEST_EVENT_KEY: "test",
      SUPABASE_URL: "http://localhost",
      SUPABASE_ANON_KEY: "test",
      SUPABASE_SERVICE_ROLE_KEY: "test",
      SUPABASE_API_URL: "http://localhost",
      SESSION_SECRET: "test",
      REDIS_URL: "redis://localhost",
    },
  },
});
