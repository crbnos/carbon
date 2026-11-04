// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * The row whose contact a customer or supplier syncs with: the first one with
 * an email, else the first. A party's contacts arrive in no fixed order, and a
 * contact with no email must not blank the email an accounting system sends
 * invoices and purchase orders to.
 */
export function partyContactRow<T extends { contactEmail: string | null }>(
  rows: readonly T[]
): T | undefined {
  return rows.find((row) => row.contactEmail?.trim()) ?? rows[0];
}
