import { assertEquals } from "https://deno.land/std@0.175.0/testing/asserts.ts";
import { getFunctionLogger } from "./logging.ts";

Deno.test({
  name: "logger defaults safely when environment access is denied",
  permissions: { env: false },
  fn: () => {
    const logger = getFunctionLogger("permissionless-test");

    assertEquals(logger.category, ["carbon", "edge", "permissionless-test"]);
  },
});
