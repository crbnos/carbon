import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { getAuthorizedChangeNoticeImpactHistory } from "~/modules/items/items.server";

/** Lazy, source-aware read for one persisted Impact decision's history. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "parts"
  });
  const { id: changeNoticeId, decisionId } = params;
  if (!changeNoticeId || !decisionId) {
    return data(
      {
        data: null,
        error: { message: "Impact history is unavailable." }
      },
      { status: 404 }
    );
  }

  const result = await getAuthorizedChangeNoticeImpactHistory({
    client,
    userId,
    companyId,
    changeNoticeId,
    decisionId
  });
  if (result.error || !result.data) {
    const notFound =
      result.error?.kind === "not-found" || result.error?.kind === "restricted";
    return data(
      {
        data: null,
        error: {
          message: notFound
            ? "Impact history is unavailable."
            : (result.error?.message ?? "Impact history could not be loaded.")
        }
      },
      { status: notFound ? 404 : 503 }
    );
  }

  return result.data;
}
