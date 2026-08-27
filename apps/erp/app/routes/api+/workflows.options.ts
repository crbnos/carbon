import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { OPTIONS_PROVIDERS } from "~/modules/workflows/options-providers.server";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "workflows", "options");

const FAILED = "Couldn't load the choices for this field.";

/** A JSON query parameter of plain string values, or `{}` — a malformed one is an
 * empty bag rather than a failure, since a provider decides what it needs anyway. */
function readStringMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const map: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") map[key] = value;
    }
    return map;
  } catch {
    return {};
  }
}

/**
 * Resolves one workflow input's choices while the author is still editing the node.
 * Provider-agnostic: the permission and the lookup both come from the registry
 * entry, so this route never learns what any particular list is.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const providerId = url.searchParams.get("provider");
  const provider = providerId ? OPTIONS_PROVIDERS[providerId] : undefined;

  if (provider === undefined) {
    // Still behind auth: an unknown provider must not be a way to probe the app
    // unauthenticated. `workflows_view` is the weakest permission any provider uses.
    await requirePermissions(request, { view: "workflows" });
    logger.error("Unknown workflow options provider", { provider: providerId });
    return { options: [], error: FAILED };
  }

  const { client, companyId } = await requirePermissions(
    request,
    provider.permission
  );

  try {
    return await provider.resolve({
      client,
      companyId,
      params: readStringMap(url.searchParams.get("params")),
      values: readStringMap(url.searchParams.get("values")),
      search: url.searchParams.get("search") ?? undefined
    });
  } catch (err) {
    // Never echo a provider's raw payload: for an integration it can carry the
    // vendor's own message, and the auth value is never far from it.
    logger.error("Workflow options lookup failed", {
      provider: providerId,
      message: err instanceof Error ? err.message : ""
    });
    return { options: [], error: FAILED };
  }
}
