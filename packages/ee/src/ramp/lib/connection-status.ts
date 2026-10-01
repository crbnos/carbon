// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Reading Ramp's accounting-connection list.
 *
 * A leaf module (no supabase, no env) so both the healthcheck and the OAuth
 * callback answer "is anything actually connected?" the same way. They did not:
 * the callback took the first connection carrying a `remote_provider_name`
 * regardless of status, while the healthcheck required a live one.
 *
 * That gap is reachable, not theoretical. `DELETE /accounting/connection` does
 * NOT remove the record — verified live 2026-09-25, it returns 204 and leaves:
 *
 *   { "status": "unlinked", "is_active": false, "settings": null,
 *     "remote_provider_name": "Carbon", "id": "06c58d3c-…" }
 *
 * So a business that has EVER had a connection keeps a tombstone carrying the
 * old provider's name forever. Without the status filter, a push-only install
 * would read that tombstone and report "Ledger held by Carbon" — naming a system
 * that is not connected, and hiding the fact that nobody is.
 */

export type RampConnection = {
  id?: string;
  status?: string | null;
  remote_provider_name?: string | null;
};

/**
 * The `remote_provider_name` Carbon writes when it creates the connection, and
 * therefore the only value that identifies a connection as CARBON'S.
 */
export const CARBON_PROVIDER_NAME = "Carbon";

export function isCarbonConnection(connection: RampConnection): boolean {
  return (
    connection.remote_provider_name?.toLowerCase() ===
    CARBON_PROVIDER_NAME.toLowerCase()
  );
}

/** Ramp connection statuses that count as live. */
export function isConnectionLinked(status: string | null | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (
    normalized === "linked" ||
    normalized === "active" ||
    normalized === "connected"
  );
}

/**
 * Extract a connection list from `{ connections: [...] }` (Ramp), `{ data: [...] }`,
 * or a bare array.
 */
export function extractConnections(response: unknown): RampConnection[] {
  if (Array.isArray(response)) return response as RampConnection[];
  if (response && typeof response === "object") {
    const obj = response as { connections?: unknown; data?: unknown };
    if (Array.isArray(obj.connections))
      return obj.connections as RampConnection[];
    if (Array.isArray(obj.data)) return obj.data as RampConnection[];
  }
  return [];
}

/** The live connections only. */
export function linkedConnections(response: unknown): RampConnection[] {
  return extractConnections(response).filter((connection) =>
    isConnectionLinked(connection.status)
  );
}

/**
 * Which system holds Ramp's accounting seat, or undefined when nobody does.
 *
 * Undefined deliberately conflates "no live connection" with "the live one did
 * not name itself" — neither is something a caller may present as a fact, and
 * the healthcheck re-reads live rather than trusting a stored snapshot.
 */
export function resolveConnectedProviderName(
  response: unknown
): string | undefined {
  return linkedConnections(response).find(
    (connection) => connection.remote_provider_name
  )?.remote_provider_name as string | undefined;
}

/**
 * Ramp's single accounting seat is held by a system that is not Carbon.
 *
 * A distinct code because this is the ONE install failure with a specific,
 * actionable remedy — and it is the exact conflict push-only mode exists for. The
 * OAuth callback maps it to its own copy instead of the generic "setup didn't
 * finish", which would leave the customer with no idea what to do.
 */
export const RAMP_SEAT_CONFLICT_CODE = "RAMP_SEAT_CONFLICT";

export class RampSeatConflictError extends Error {
  readonly code = RAMP_SEAT_CONFLICT_CODE;
  /** The system Ramp reports as holding the seat, when it named one. */
  readonly holder: string | undefined;

  constructor(holder: string | undefined) {
    super(
      `Ramp's accounting connection is held by ${
        holder ?? "another system"
      }. Disconnect it in Ramp, or reconnect Carbon in push-only mode so that system keeps posting your ledger.`
    );
    this.name = "RampSeatConflictError";
    this.holder = holder;
  }
}

/**
 * Structural check, not `instanceof`: the error crosses a package boundary and
 * may be re-thrown or serialized on the way to the route that renders it.
 */
export function isRampSeatConflict(error: unknown): boolean {
  return (
    typeof (error as { code?: unknown })?.code === "string" &&
    (error as { code: string }).code === RAMP_SEAT_CONFLICT_CODE
  );
}
