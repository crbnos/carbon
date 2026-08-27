import type { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  getConnection,
  listConnections,
  resolveConnectionAuth
} from "@carbon/ee/integrations/connections";
import {
  buildRefreshConfig,
  CONNECTION_PROVIDER,
  getPieceAction,
  PROPERTY_PROVIDER
} from "@carbon/jobs/integrations";
import type { SupabaseClient } from "@supabase/supabase-js";
import { path } from "~/utils/path";

/**
 * Every list the workflow builder fetches while a node is being edited.
 *
 * A catalog input names a provider by id and the builder forwards it verbatim, so
 * this registry is the only place that knows what a provider id MEANS. Nothing here
 * is integration-specific by construction: a provider backed by Carbon's own data
 * is one more entry, and needs no change to the catalog format, the endpoint or the
 * field that renders it.
 */

export type OptionsProviderContext = {
  /** The requester's own client — RLS applies, so it is what scopes a lookup. */
  client: SupabaseClient<Database>;
  companyId: string;
  /** Fixed arguments from the catalog entry. */
  params: Record<string, string>;
  /** Current values of the input's `dependsOn` inputs. */
  values: Record<string, string>;
  search?: string;
};

export type ProviderOption = { label: string; value: string };

export type OptionsProviderResult = {
  options: ProviderOption[];
  /** Where the author can go to create the first one, when there are none. */
  emptyHref?: string;
};

export type OptionsProvider = {
  /** Checked before the provider runs, so a provider can never be a way around a
   * permission the equivalent action carries. */
  permission: Parameters<typeof requirePermissions>[1];
  resolve: (context: OptionsProviderContext) => Promise<OptionsProviderResult>;
};

/** The company's connections for one piece. Non-secret fields only. */
const connectionProvider: OptionsProvider = {
  permission: { view: "workflows" },
  resolve: async ({ client, companyId, params }) => {
    const piece = params.piece;
    if (!piece) return { options: [] };

    const { data } = await listConnections(client, companyId, piece);

    return {
      options: (data ?? []).map((row) => ({
        value: row.id,
        label:
          row.status === "Active"
            ? row.accountLabel
              ? `${row.name} · ${row.accountLabel}`
              : row.name
            : `${row.name} (${row.status})`
      })),
      emptyHref: path.to.integrations
    };
  }
};

/**
 * One piece property's own `options()`, run against a chosen connection — "pick a
 * calendar". Gated on `workflows_update`, the same permission the action carries,
 * so it cannot reach a vendor a user could not otherwise call.
 */
const propertyProvider: OptionsProvider = {
  permission: { update: "workflows" },
  resolve: async ({ client, companyId, params, values, search }) => {
    const { piece, action: actionName, prop } = params;
    const connectionId = values.connectionId;
    if (!piece || !actionName || !prop || !connectionId) return { options: [] };

    // Scope the connection to this company through the user's own client first;
    // the vault RPCs below are service-role only and would skip that check.
    const { data: owned } = await getConnection(
      client,
      companyId,
      connectionId
    );
    if (owned === null || owned.pieceName !== piece) return { options: [] };

    const action = await getPieceAction(piece, actionName);
    const property = action.props[prop];
    if (property === undefined || typeof property.options !== "function") {
      throw new Error(
        `${piece}.${actionName}.${prop} has no options to fetch.`
      );
    }

    const { accessToken } = await resolveConnectionAuth(
      getCarbonServiceRole(),
      companyId,
      connectionId,
      await buildRefreshConfig(piece)
    );

    // A dropdown's `refreshers` may name sibling props, so pass what the node has.
    const propsValue: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      if (key in action.props) propsValue[key] = value;
    }

    const resolved = (await (
      property.options as (context: unknown) => Promise<unknown>
    )({
      auth: { access_token: accessToken },
      propsValue,
      searchValue: search
    })) as { options?: { label: string; value: unknown }[] };

    return {
      options: (resolved.options ?? []).map((option) => ({
        label: option.label,
        value: String(option.value)
      }))
    };
  }
};

export const OPTIONS_PROVIDERS: Record<string, OptionsProvider> = {
  [CONNECTION_PROVIDER]: connectionProvider,
  [PROPERTY_PROVIDER]: propertyProvider
};
