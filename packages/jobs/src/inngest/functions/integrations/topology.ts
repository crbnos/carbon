import type { getCarbonServiceRole } from "@carbon/auth/client.server";
import { resolveIntegrationTopology } from "@carbon/ee";
import type { IntegrationTopology } from "@carbon/ee/sync";

/**
 * Read a company's integration topology.
 *
 * Lives in its own module because it imports the `@carbon/ee` BARREL — which
 * pulls every integration descriptor and validates the server env at import
 * time. Entry points (Inngest functions) import this; the decision cores take
 * the resolved topology as an argument and stay env-free and testable.
 */
export async function loadIntegrationTopology(
  client: ReturnType<typeof getCarbonServiceRole>,
  companyId: string
): Promise<IntegrationTopology> {
  const rows = await client
    .from("companyIntegration")
    .select("id, active")
    .eq("companyId", companyId);

  return resolveIntegrationTopology(rows.data ?? []);
}
