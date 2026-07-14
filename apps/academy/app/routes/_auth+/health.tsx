import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";

const log = getLogger("academy");

export async function loader() {
  try {
    const client = getCarbonServiceRole();
    const test = await client.from("attributeDataType").select("*");
    if (test.error !== null) throw test.error;
    return new Response("OK");
  } catch (error: unknown) {
    log.error("health check failed", { error });
    return new Response("ERROR", { status: 500 });
  }
}
