import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { syncIssueFromLinearSchema, trigger } from "@carbon/jobs";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getIntegration } from "~/modules/settings/settings.service.server";
import { runWithSystemContext } from "~/services/mcp/index.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = params;
  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  return {
    success: true
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { companyId } = params;

  if (!companyId) {
    return data({ success: false }, { status: 400 });
  }

  // Public webhook: no session/middleware identity. The URL companyId is the
  // target tenant (not an actor) — pass it into the request-scoped context so
  // service code reading `AuthContextHolder.get().companyId` is satisfied.
  return runWithSystemContext(
    { companyId },
    getCarbonServiceRole(),
    async () => {
      const integration = await getIntegration("linear", companyId);

      if (integration.error) {
        console.error(
          "Linear webhook: integration query failed",
          integration.error
        );
        return data(
          { success: false, error: "Integration query failed" },
          { status: 400 }
        );
      }

      if (!integration.data) {
        return data(
          { success: false, error: "Integration not configured" },
          { status: 400 }
        );
      }

      if (!integration.data.active) {
        return data(
          { success: false, error: "Integration not active" },
          { status: 400 }
        );
      }

      const body = await request.json();

      const parsed = syncIssueFromLinearSchema.safeParse({
        companyId,
        event: body
      });

      if (!parsed.success) {
        return data(
          { success: false, error: parsed.error.format() },
          { status: 400 }
        );
      }

      try {
        await trigger("sync-issue-from-linear", parsed.data);
        return { success: true };
      } catch (err) {
        console.error("Linear webhook: failed to trigger task", err);
        return data({ success: false }, { status: 500 });
      }
    }
  );
}
