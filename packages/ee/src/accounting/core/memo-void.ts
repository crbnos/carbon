// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Which providers can VOID a synced credit memo / supplier credit.
 *
 * The sibling declarations for the other two document families live in
 * `core/posting.ts` (`CHARGE_NATIVE_VOID_PROVIDERS`,
 * `REIMBURSEMENT_NATIVE_VOID_PROVIDERS`). This one is deliberately separate:
 * it exists to make an OPEN HOLE visible, not to declare a shipped capability.
 *
 * **Only Rillet has a memo void path.** Its memo syncers extend
 * `RilletPushOnlyEntitySyncer`, whose `pushToAccounting` calls `deleteRemote`
 * when the local memo is Voided and a mapping exists. The Xero and QBO memo
 * syncers extend `BaseEntitySyncer`, which has no `deleteRemote` at all — so
 * voiding a Xero- or QBO-synced credit memo leaves the remote credit note /
 * CreditMemo LIVE, AR (or AP) permanently reduced in the ledger of record, and
 * nothing failing anywhere. That is the hole; it is declared here as a capability
 * set rather than left implied by a bare provider-id comparison in the reconciler —
 * which is also what `no-integration-id-branching` exists to prevent. (That check
 * scans raw text, so do not spell such a comparison out in prose here either.)
 *
 * Closing it means a new remote lifecycle on each adapter — Xero
 * `Status: "VOIDED"` on the credit note (refused once allocated), QBO
 * `POST /creditmemo?operation=delete` / `POST /vendorcredit?operation=delete`
 * with the current `SyncToken` — plus reversing the applications first. It was
 * scoped out of the self-review pass on purpose (decision D-4 in
 * `.ai/plans/implemented/2026-09-28-self-review-must-fixes.md`): a new lifecycle is not a
 * defect fix.
 *
 * Keep this set in step with the memo syncers' `deleteRemote`. A provider named
 * here without one has its void silently suppressed as "no active native push
 * mapping to void"; a provider MISSING here that gained one never gets asked.
 */
export const MEMO_NATIVE_VOID_PROVIDERS: ReadonlySet<string> = new Set([
  "rillet"
]);

/** Can this provider void a synced memo at all? */
export function providerSupportsNativeMemoVoid(providerId: string): boolean {
  return MEMO_NATIVE_VOID_PROVIDERS.has(providerId);
}
