/**
 * Carbon's `external_references` contract with Rillet — the leaf both the
 * provider and the entity syncers read.
 *
 * Extracted from `entities/shared.ts` so `provider.ts` can read a record's
 * Carbon origin (the counterpart ladder's strongest rung) without importing
 * `entities/shared.ts`, which imports `../provider` and would close a cycle.
 * `entities/shared.ts` re-exports these, so every existing import path still
 * resolves.
 */

import type { Rillet } from "./models";

/** external_references entries Carbon writes always use this type. */
export const RILLET_CARBON_REFERENCE_TYPE = "carbon";

/**
 * Origin tag for multi-instance deployments: several self-hosted Carbon
 * instances can write to one Rillet organization (one subsidiary each),
 * and Carbon entity ids are only unique within one database. The company
 * reference makes every pushed document's origin auditable from Rillet.
 */
export const RILLET_CARBON_COMPANY_REFERENCE_TYPE = "carbon-company";

export function carbonExternalReference(id: string): Rillet.ExternalReference {
  return { type: RILLET_CARBON_REFERENCE_TYPE, id };
}

export function carbonCompanyExternalReference(
  companyId: string
): Rillet.ExternalReference {
  return { type: RILLET_CARBON_COMPANY_REFERENCE_TYPE, id: companyId };
}

/**
 * The Carbon entity id a Rillet record was pushed FROM, read back off its
 * `external_references`. Only trusted when the record also carries this
 * company's `carbon-company` reference: several Carbon instances can write
 * into one Rillet organization, and entity ids are only unique within one
 * database, so an unqualified `carbon` reference could name a DIFFERENT
 * instance's customer whose id happens to collide. A reference with no
 * company tag at all is from before that tag shipped and is accepted.
 */
export function readCarbonExternalReference(
  references: Rillet.ExternalReference[] | undefined,
  companyId: string
): string | null {
  if (!references?.length) return null;

  const companyRefs = references.filter(
    (reference) => reference.type === RILLET_CARBON_COMPANY_REFERENCE_TYPE
  );
  if (companyRefs.length > 0 && !companyRefs.some((r) => r.id === companyId)) {
    return null;
  }

  const carbonRef = references.find(
    (reference) => reference.type === RILLET_CARBON_REFERENCE_TYPE
  );
  return carbonRef?.id ?? null;
}
