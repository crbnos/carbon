// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { hasPermission } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { OPTIONS_PROVIDERS } from "~/modules/workflows/workflows.service";

export const config = {
  runtime: "nodejs"
};

const logger = getLogger("erp", "workflows", "options");

/** Codes, not sentences — the builder owns the wording so it can translate it. */
const FAILED = "failed" as const;
const FORBIDDEN = "forbidden" as const;

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
  // Own keys only: `?provider=constructor` must not reach Object.prototype.
  const provider =
    providerId && Object.hasOwn(OPTIONS_PROVIDERS, providerId)
      ? OPTIONS_PROVIDERS[providerId]
      : undefined;

  // `workflows_view` is the weakest permission any provider uses, and anyone who
  // can open the builder holds it. The provider's own permission is checked below
  // rather than here: `requirePermissions` answers a denial with a redirect, and a
  // fetcher follows it as a navigation — a viewer opening a node was sent home.
  const { companyId, permissions } = await requirePermissions(request, {
    view: "workflows"
  });

  if (provider === undefined) {
    logger.error("Unknown workflow options provider", { provider: providerId });
    return { options: [], errorCode: FAILED };
  }

  const allowed = (
    Object.keys(provider.permission) as (keyof typeof provider.permission)[]
  ).every((action) =>
    hasPermission(permissions, provider.permission[action]!, action, companyId)
  );
  if (!allowed) return { options: [], errorCode: FORBIDDEN };

  try {
    return await provider.resolve({
      companyId,
      params: readStringMap(url.searchParams.get("params")),
      values: readStringMap(url.searchParams.get("values"))
    });
  } catch (err) {
    // Never echo a provider's raw payload to the CUSTOMER — for an integration it
    // carries the vendor's own message, and the auth value is never far from it.
    // The server log is a different audience: without the error's name and the
    // vendor's status code, "lookup failed" is unactionable, and a piece's
    // `HttpError` carries a JSON blob as its `message` that says nothing on its own.
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? (err as { status?: unknown }).status
        : undefined;
    // Every field is a {placeholder} in the MESSAGE: the dev console uses LogTape's
    // `ansiColorFormatter`, which renders the template and drops any property it
    // does not reference — so unreferenced fields were invisible, and "lookup
    // failed" said nothing an operator could act on.
    const name = err instanceof Error ? err.name : typeof err;
    const detail = err instanceof Error ? err.message.slice(0, 300) : "";
    logger.error(
      "Workflow options lookup failed: provider={providerId} error={name} status={status} detail={detail}",
      { providerId, name, status: status ?? "none", detail }
    );
    return { options: [], errorCode: FAILED };
  }
}
