import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getJobDocuments } from "~/modules/production/production.service.server";
import { getCompanyIntegration } from "~/modules/settings/settings.server";
import { AuthClientScope } from "~/services/mcp/index.server";

const integrationMetadataParser = z.object({
  processes: z.array(z.string())
});

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  // getJobDocuments is clientless and resolves its client from
  // AuthClientScope. On main it was called with serviceRole (RLS-bypass)
  // while the rest of this route used the request-scoped `client`. Pin the
  // scope to serviceRole so getJobDocuments keeps that behavior;
  // getCompanyIntegration / client.rpc below still use the explicit `client`.
  const serviceRole = getCarbonServiceRole();
  AuthClientScope.setFactory(() => serviceRole);

  const integration = await getCompanyIntegration(client, companyId, "radan");
  if (!integration) {
    return data(
      { success: false, error: "Integration not active" },
      { status: 400 }
    );
  }

  const metadata = integrationMetadataParser.safeParse(integration.metadata);
  if (!metadata.success) {
    return data({ success: false, error: "Invalid metadata" }, { status: 400 });
  }

  const { processes } = metadata.data;

  if (!params.version) {
    return data(
      { success: false, error: "Version is required" },
      { status: 400 }
    );
  }

  if (params.version === "v1") {
    const result = await client.rpc("get_radan_v1", {
      company_id: companyId,
      processes
    });

    if (result.error) {
      return data(
        { success: false, error: result.error.message },
        { status: 500 }
      );
    }

    // Cache for job documents to avoid duplicate fetches
    const jobDocumentsCache = new Map();

    // Enrich data with job documents
    const enrichedData = await Promise.all(
      result.data.map(async (item: any) => {
        if (item.jobId) {
          let documents;
          if (jobDocumentsCache.has(item.jobId)) {
            documents = jobDocumentsCache.get(item.jobId);
          } else {
            documents = await getJobDocuments({
              id: item.jobId,
              salesOrderLineId: item.salesOrderLineId,
              itemId: item.itemId
            });
            jobDocumentsCache.set(item.jobId, documents);
          }
          return {
            ...item,
            documents
          };
        }
        return item;
      })
    );

    return { success: true, data: enrichedData };
  }

  return {
    success: false,
    error: `version ${params.version} is invalid`
  };
}
