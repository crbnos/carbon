import type { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
import {
  ConnectionRefreshTimeoutError,
  ConnectionRevokedError,
  ConnectionSecretUnavailableError,
  readConnection,
  readConnections,
  resolveConnectionAuth,
  usableConnections
} from "@carbon/ee/integrations/connections";
import {
  buildRefreshConfig,
  CONNECTION_PROVIDER,
  getPieceAction,
  PROPERTY_PROVIDER
} from "@carbon/jobs/integrations";
import { getLogger } from "@carbon/logger";
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

const logger = getLogger("erp", "workflows", "options");

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

/** Why a dropdown could not be filled. Resolved to words in the builder. */
export type OptionsErrorCode = "reconnect" | "refreshing" | "failed";

export type OptionsProviderResult = {
  options: ProviderOption[];
  /** Where the author can go to create the first one, when there are none. */
  emptyHref?: string;
  /** Why this list could not be loaded, when we know a reason worth saying.
   * A CODE, not a sentence: the wording is the builder's, so it goes through
   * Lingui like every other string the author reads. */
  errorCode?: OptionsErrorCode;
  /** Where to go and do it. */
  errorHref?: string;
};

export type OptionsProvider = {
  /** Checked before the provider runs, so a provider can never be a way around a
   * permission the equivalent action carries. */
  permission: Parameters<typeof requirePermissions>[1];
  resolve: (context: OptionsProviderContext) => Promise<OptionsProviderResult>;
};

/**
 * The company's connections for one piece. Non-secret fields only.
 *
 * Read through the SERVICE role, then scoped to `companyId` here. The row's RLS
 * SELECT policy demands `settings_view`, but this provider is gated on
 * `workflows_view` — a workflow author who cannot administer Settings would
 * otherwise get an empty list and be told the app "isn't connected yet", with
 * nothing anywhere reporting that the rows had been filtered away. The company
 * scope is not weakened: `requirePermissions` resolved `companyId` for this
 * request, and only non-secret columns leave here.
 *
 * Only USABLE accounts are offered. A revoked account in a dropdown is a trap —
 * picking it builds a workflow that cannot run.
 */
const connectionProvider: OptionsProvider = {
  permission: { view: "workflows" },
  resolve: async ({ companyId, params }) => {
    const piece = params.piece;
    if (!piece) return { options: [] };

    const rows = usableConnections(
      await readConnections(getCarbonServiceRole(), companyId, piece)
    );

    return {
      options: rows.map((row) => ({
        value: row.id,
        label: row.accountLabel ? `${row.name} · ${row.accountLabel}` : row.name
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
    const owned = await readConnection(client, companyId, connectionId);
    if (owned === null || owned.pieceName !== piece) return { options: [] };

    const action = await getPieceAction(piece, actionName);
    const property = action.props[prop];
    if (property === undefined || typeof property.options !== "function") {
      throw new Error(
        `${piece}.${actionName}.${prop} has no options to fetch.`
      );
    }

    // OUTSIDE the try below. Loading the piece to read its token URL can fail for
    // reasons that have nothing to do with the account — a missing package, an
    // unset OAuth env var — and inside that catch such a failure fell through to
    // `throw cause` and became a 500, or worse, read to the author as "reconnect
    // this account". Reconnecting cannot fix a piece that will not load.
    //
    // Named in the log rather than swallowed: this failure looks identical to a
    // dead account from the outside, and telling them apart is the whole
    // difference between "reconnect" and "fix the server's OAuth config".
    let refreshConfig: Awaited<ReturnType<typeof buildRefreshConfig>>;
    try {
      refreshConfig = await buildRefreshConfig(piece);
    } catch (cause) {
      logger.error(
        `Could not build the refresh config for ${piece}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`
      );
      return { options: [], errorCode: "failed" };
    }

    // A connection problem is not a generic lookup failure: the author cannot fix
    // "couldn't load the choices", but they can reconnect an account. Naming it is
    // the difference between a dead end and one click.
    let accessToken: string;
    try {
      ({ accessToken } = await resolveConnectionAuth(
        getCarbonServiceRole(),
        companyId,
        connectionId,
        refreshConfig
      ));
    } catch (cause) {
      if (
        cause instanceof ConnectionRevokedError ||
        cause instanceof ConnectionSecretUnavailableError
      ) {
        return {
          options: [],
          errorCode: "reconnect",
          errorHref: path.to.integrations
        };
      }
      if (cause instanceof ConnectionRefreshTimeoutError) {
        return {
          options: [],
          errorCode: "refreshing"
        };
      }
      throw cause;
    }

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
