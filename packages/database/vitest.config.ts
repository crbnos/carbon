import base from "@carbon/config/vitest";
import { mergeConfig } from "vitest/config";

// The edge functions are Deno, so their pure helpers live outside `src` and the
// shared base config's include glob misses them. The tests listed in `exclude`
// import from deno.land over https and only run under `deno test` — Vite can't
// resolve those specifiers.
export default mergeConfig(base, {
  test: {
    include: ["supabase/functions/shared/**/*.test.ts"],
    exclude: [
      "supabase/functions/shared/post-adjustment.test.ts",
      "supabase/functions/shared/purchase-cost-adjustment.test.ts",
      "supabase/functions/shared/short-close.test.ts",
    ],
  },
});
