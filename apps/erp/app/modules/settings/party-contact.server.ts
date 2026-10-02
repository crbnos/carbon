// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import { unchecked } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  missingPartyFacts,
  PARTY_CONTACT_SETTING,
  type PartyKind,
  partyContactRequiredMessage
} from "./party-contact";

const logger = getLogger("erp", "party-contact");

/**
 * Enforce the "party must have a reachable contact AND an identifiable
 * location" setting at a document boundary.
 *
 * Returns an error MESSAGE, or null when the document may proceed. A route
 * turns that into its own flash/validation shape rather than this throwing,
 * because the six call sites (supplier quote, purchase order, purchase invoice
 * and their sales mirrors) each report failure differently.
 *
 * Fails OPEN on a read error. This gate exists to stop a document reaching a
 * platform that will reject it — a transient database hiccup is not a reason to
 * block someone from posting, and the push itself still refuses with a named
 * error if the record really is incomplete. But a fail-open that says nothing is
 * indistinguishable from a passing gate, so every degradation is logged: a
 * permanently broken read would otherwise disable a setting the customer turned
 * on, silently and forever.
 */
export async function checkPartyContactRequirement(
  client: SupabaseClient<Database>,
  companyId: string,
  party: { kind: PartyKind; id: string | null | undefined }
): Promise<string | null> {
  if (!party.id) return null;

  const settingColumn = PARTY_CONTACT_SETTING[party.kind];
  const settings = await client
    .from("companySettings")
    .select(settingColumn)
    .eq("id", companyId)
    .maybeSingle();

  if (settings.error || !settings.data) {
    logger.warn("Party contact requirement skipped: settings unreadable", {
      companyId,
      kind: party.kind,
      partyId: party.id,
      error: settings.error
    });
    return null;
  }
  const required = (settings.data as Record<string, unknown>)[settingColumn];
  if (required !== true) return null;

  const isSupplier = party.kind === "supplier";
  // `supplierContact` / `customerContact` are the join rows; the email lives on
  // `contact`. Same shape for locations: the join row carries the address.
  const contactTable = isSupplier ? "supplierContact" : "customerContact";
  const locationTable = isSupplier ? "supplierLocation" : "customerLocation";
  const partyColumn = isSupplier ? "supplierId" : "customerId";

  const [contacts, locations] = await Promise.all([
    client
      .from(contactTable)
      .select("contact(email)")
      .eq(unchecked(partyColumn), party.id)
      .eq("companyId", companyId),
    client
      .from(locationTable)
      .select("address(countryCode, stateProvince)")
      .eq(unchecked(partyColumn), party.id)
      .eq("companyId", companyId)
  ]);

  // Fail open PER READ, independently: a locations query that errored must not
  // be reported as "no location", but it must not suppress a genuinely missing
  // contact either. Skipping both halves on either error made one flaky query
  // hide the other half's real finding.
  if (contacts.error || locations.error) {
    logger.warn("Party contact requirement partially skipped: read failed", {
      companyId,
      kind: party.kind,
      partyId: party.id,
      contactsError: contacts.error,
      locationsError: locations.error
    });
  }

  // The decision itself is pure and lives in `missingPartyFacts` — including the
  // countryCode→country rename and the per-read fail-open.
  const missing = missingPartyFacts({
    contacts: { rows: contacts.data, failed: Boolean(contacts.error) },
    locations: { rows: locations.data, failed: Boolean(locations.error) }
  });

  if (!missing.contact && !missing.location) return null;

  const table = isSupplier ? "supplier" : "customer";
  const named = await client
    .from(table)
    .select("name")
    .eq("id", party.id)
    .eq("companyId", companyId)
    .maybeSingle();

  if (named.error) {
    logger.warn("Party contact requirement: party name unreadable", {
      companyId,
      kind: party.kind,
      partyId: party.id,
      error: named.error
    });
  }

  return partyContactRequiredMessage(
    party.kind,
    named.data?.name ?? null,
    missing
  );
}
