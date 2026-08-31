import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { Database } from "@carbon/database";
// The deep subpath, not the `@carbon/ee` root: that barrel pulls in integration
// config files whose `msg` macro is untransformed outside a Vite build.
import {
  ConnectionRefreshTimeoutError,
  ConnectionRevokedError,
  ConnectionSecretUnavailableError,
  readConnection,
  resolveConnectionAuth
} from "@carbon/ee/integrations/connections";
import type { ActionOutcome, RuntimeValue } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PIECE_ALLOWLIST } from "../integrations/allowlist";
import { buildPieceContext } from "../integrations/context";
import { buildRefreshConfig } from "../integrations/oauth";
import { projectOutputs } from "../integrations/project";
import { toPropsValue } from "../integrations/properties";
import { getPieceAction } from "../integrations/registry";
import { pinnedValues } from "../integrations/visibility";

const NO_CONNECTION = "This step needs a connection.";
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
    const propsValue = toPropsValue(
      action.props,
      inputs,
      pinnedValues(pieceName, actionName, action.props)
    );
    const result = await action.run(
      buildPieceContext({ auth: { access_token: accessToken }, propsValue })
    );

    return {
      ok: true,
      outputs: {
        ...projectOutputs(action.outputSchema, result),
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
    return { ok: false, error: `${label} rejected this: ${truncate(message)}` };
  }
}
