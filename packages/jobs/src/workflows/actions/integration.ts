import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
// The deep subpath, not the `@carbon/ee` root: that barrel pulls in integration
// config files whose `msg` macro is untransformed outside a Vite build.
import {
  ConnectionRefreshTimeoutError,
  ConnectionRevokedError,
  ConnectionSecretUnavailableError,
  missingScopes,
  readConnection,
  resolveConnectionAuth
} from "@carbon/ee/integrations/connections";
import type { ActionOutcome, RuntimeValue } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PIECE_ALLOWLIST } from "../integrations/allowlist";
import { buildPieceContext } from "../integrations/context";
import { buildRefreshConfig, requiredScopesFor } from "../integrations/oauth";
import { projectOutputs } from "../integrations/project";
import { toPropsValue } from "../integrations/properties";
import { getPieceAction } from "../integrations/registry";
import { omittedProps, pinnedValues } from "../integrations/visibility";

const NO_CONNECTION = "This step needs a connection.";
/** A workspace connected before this piece needed a scope. The fix is one click,
 * so the words name it — a bare `missing_scope` reads as a bug report. */
const reconnectCopy = (label: string) =>
  `The ${label} connection needs to be reconnected to grant the permissions this step uses — Settings → Integrations → ${label} → Accounts → Reconnect.`;
const SCOPE_ERROR =
  /missing_scope|insufficient_scope|insufficient.?permission/i;
/** A vendor message is theirs, not ours — keep it short enough to read in a step row. */
const MAX_VENDOR_MESSAGE = 300;

function truncate(message: string): string {
  return message.length <= MAX_VENDOR_MESSAGE
    ? message
    : `${message.slice(0, MAX_VENDOR_MESSAGE)}…`;
}

function connectionIdFrom(
  inputs: Record<string, RuntimeValue>
): string | undefined {
  const value = inputs.connectionId;
  if (value === undefined || value.kind !== "primitive") return undefined;
  if (value.value === null) return undefined;
  const id = String(value.value).trim();
  return id === "" ? undefined : id;
}

export async function runIntegrationAction(args: {
  client: SupabaseClient<Database>;
  companyId: string;
  pieceName: string;
  actionName: string;
  inputs: Record<string, RuntimeValue>;
}): Promise<ActionOutcome> {
  const { client, companyId, pieceName, actionName, inputs } = args;
  const label = PIECE_ALLOWLIST[pieceName]?.label ?? pieceName;

  const connectionId = connectionIdFrom(inputs);
  if (connectionId === undefined) return { ok: false, error: NO_CONNECTION };

  // The connection must belong to THIS company and be one the piece owns.
  // Read through the owner's client, so RLS still applies to the lookup.
  const owned = await readConnection(client, companyId, connectionId);
  if (owned === null || owned.pieceName !== pieceName) {
    return { ok: false, error: NO_CONNECTION };
  }

  // Deterministic first: an under-scoped account fails here, without a vendor
  // call and without partial side effects.
  if (missingScopes(owned, await requiredScopesFor(pieceName)).length > 0) {
    return { ok: false, error: reconnectCopy(label) };
  }

  let accessToken: string;
  try {
    const oauth = await buildRefreshConfig(pieceName);
    // The vault RPCs are granted to service_role only — no user client may
    // decrypt a token. Every query inside is scoped by the run's `companyId`.
    ({ accessToken } = await resolveConnectionAuth(
      getCarbonServiceRole(),
      companyId,
      connectionId,
      oauth
    ));
  } catch (cause) {
    // A busy refresh is transient and a retry fixes it; a revoked or unreadable
    // token needs a person. Telling the customer to reconnect in the first case
    // would send them to do work that changes nothing.
    if (cause instanceof ConnectionRefreshTimeoutError) {
      return {
        ok: false,
        error: `The ${label} connection was busy refreshing. Try again.`
      };
    }
    if (
      cause instanceof ConnectionRevokedError ||
      cause instanceof ConnectionSecretUnavailableError
    ) {
      return {
        ok: false,
        error: `The ${label} connection needs to be reconnected.`
      };
    }
    // Anything else is ours, not theirs — a missing OAuth app reaches here.
    return { ok: false, error: `The ${label} connection is unavailable.` };
  }

  try {
    const action = await getPieceAction(pieceName, actionName);
    // An omitted prop is not part of the step, whatever a saved node says: the
    // catalog never offered it, so a value for it is stale or hand-posted.
    const omitted = omittedProps(pieceName, actionName, action.props);
    const offered = Object.fromEntries(
      Object.entries(inputs).filter(([name]) => !omitted.has(name))
    );
    const propsValue = toPropsValue(
      action.props,
      offered,
      pinnedValues(pieceName, actionName, action.props)
    );
    const result = await action.run(
      buildPieceContext({ auth: { access_token: accessToken }, propsValue })
    );

    return {
      ok: true,
      outputs: {
        ...projectOutputs(action.outputSchema, result, {
          sortItemsBy: PIECE_ALLOWLIST[pieceName]?.sortItemsBy?.[actionName]
        }),
        result: {
          kind: "primitive",
          of: "string",
          value: typeof result === "string" ? result : JSON.stringify(result)
        }
      },
      summary: `${label}: ${action.displayName} ran.`
    };
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "The step did not complete.";
    // A vendor scope error still reads as "reconnect", not as a bug.
    if (SCOPE_ERROR.test(message)) {
      return { ok: false, error: reconnectCopy(label) };
    }
    return { ok: false, error: `${label} rejected this: ${truncate(message)}` };
  }
}
