import { getCarbonServiceRole } from "@carbon/auth/client.server";
import {
  disconnectConnection,
  listConnections
} from "../integrations/connections";

const PIECE_NAME = "google-calendar";

/**
 * Uninstalling the card revokes every Google account connected to it.
 *
 * The card is the only place these connections are managed, so an uninstall that
 * left live tokens behind would leave the customer holding credentials they can no
 * longer see. The rows survive `disconnectConnection` by design — a saved workflow
 * node still references the id and reads "reconnect this" rather than breaking.
 *
 * Serial rather than batched: each disconnect is a vault RPC plus a row update, and
 * a company has a handful of accounts, not thousands.
 */
export async function googleCalendarOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  const { data } = await listConnections(client, companyId, PIECE_NAME);

  for (const connection of data ?? []) {
    if (connection.status === "Revoked") continue;
    await disconnectConnection(client, companyId, connection.id, "system");
  }
}
