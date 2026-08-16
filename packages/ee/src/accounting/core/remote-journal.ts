import type { AccountingProvider } from "../providers";
import type { Qbo } from "../providers/quickbooks-online";
import { QboProvider } from "../providers/quickbooks-online";
import type { Rillet } from "../providers/rillet";
import { RilletProvider } from "../providers/rillet";
import type { Xero } from "../providers/xero";
import { XeroProvider } from "../providers/xero";

/**
 * Provider-agnostic read of one Carbon-pushed provider journal, for the
 * tie-out's external-fidelity check (v3 spec §5): net DEBIT-SIGNED totals
 * per remote account ref (debits positive, credits negative).
 *
 * `found: false` means the entry is missing, voided, or deleted remotely —
 * the same drift semantics as the weekly presence check. A missing entity
 * NEVER throws (each provider's read returns null on failure); a
 * RatelimitError raised by the provider client propagates untouched so
 * callers can pace themselves.
 *
 * The account ref is whatever the provider's journal payload exposes:
 * Xero `AccountCode`, Rillet `account_code`, QBO `AccountRef.value` (the
 * provider account id). Callers map refs back to Carbon accounts via the
 * account-mapping rows, which carry both the external id and the external
 * code.
 */
export type RemoteJournalTotals = {
  found: boolean;
  /** Net debit-signed total per remote account ref. Empty when not found. */
  debitTotalsByAccountRef: Map<string, number>;
};

function notFound(): RemoteJournalTotals {
  return { found: false, debitTotalsByAccountRef: new Map() };
}

/** Accumulate in integer cents so per-ref nets carry no float residue. */
function addCents(
  centsByRef: Map<string, number>,
  ref: string | null | undefined,
  cents: number
): void {
  if (!ref) return;
  centsByRef.set(ref, (centsByRef.get(ref) ?? 0) + cents);
}

function toAmounts(centsByRef: Map<string, number>): Map<string, number> {
  const totals = new Map<string, number>();
  for (const [ref, cents] of centsByRef) {
    totals.set(ref, cents / 100);
  }
  return totals;
}

/** Xero manual-journal LineAmounts are debit-signed already; ref = AccountCode. */
export function sumXeroManualJournalDebitTotals(
  journal: Pick<Xero.ManualJournal, "JournalLines">
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const line of journal.JournalLines ?? []) {
    addCents(
      cents,
      line.AccountCode,
      Math.round((Number(line.LineAmount) || 0) * 100)
    );
  }
  return toAmounts(cents);
}

/**
 * Rillet items carry an unsigned 2-dp string amount plus an explicit side:
 * DEBIT adds, CREDIT subtracts; ref = account_code (always present on the
 * payload, unlike the server-resolved optional account_id).
 */
export function sumRilletJournalEntryDebitTotals(
  entry: Pick<Rillet.JournalEntry, "items">
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const item of entry.items ?? []) {
    const magnitude = Math.round((Number(item.amount?.amount) || 0) * 100);
    addCents(
      cents,
      item.account_code,
      item.side === "CREDIT" ? -magnitude : magnitude
    );
  }
  return toAmounts(cents);
}

/**
 * QBO line Amounts are always positive; PostingType "Debit" adds, "Credit"
 * subtracts; ref = JournalEntryLineDetail.AccountRef.value.
 */
export function sumQboJournalEntryDebitTotals(
  entry: Pick<Qbo.JournalEntry, "Line">
): Map<string, number> {
  const cents = new Map<string, number>();
  for (const line of entry.Line ?? []) {
    const detail = line.JournalEntryLineDetail;
    if (!detail) continue;
    const magnitude = Math.round((Number(line.Amount) || 0) * 100);
    addCents(
      cents,
      detail.AccountRef.value,
      detail.PostingType === "Credit" ? -magnitude : magnitude
    );
  }
  return toAmounts(cents);
}

/**
 * Fetch one pushed provider journal by external id and reduce it to net
 * debit-signed totals per remote account ref. Dispatches on the concrete
 * provider class (the same discrimination core/service.ts uses to build
 * providers). A provider without a journal reader — or an unknown provider
 * — resolves found:false rather than throwing.
 */
export async function fetchRemoteJournalTotals(
  provider: AccountingProvider,
  externalId: string
): Promise<RemoteJournalTotals> {
  if (provider instanceof XeroProvider) {
    if (typeof provider.getManualJournal !== "function") return notFound();
    const journal = await provider.getManualJournal(externalId);
    if (
      !journal ||
      journal.Status === "VOIDED" ||
      journal.Status === "DELETED"
    ) {
      return notFound();
    }
    return {
      found: true,
      debitTotalsByAccountRef: sumXeroManualJournalDebitTotals(journal)
    };
  }

  if (provider instanceof RilletProvider) {
    if (typeof provider.getJournalEntry !== "function") return notFound();
    const entry = await provider.getJournalEntry(externalId);
    if (!entry) return notFound();
    return {
      found: true,
      debitTotalsByAccountRef: sumRilletJournalEntryDebitTotals(entry)
    };
  }

  if (provider instanceof QboProvider) {
    if (typeof provider.getJournalEntry !== "function") return notFound();
    const entry = await provider.getJournalEntry(externalId);
    if (!entry) return notFound();
    return {
      found: true,
      debitTotalsByAccountRef: sumQboJournalEntryDebitTotals(entry)
    };
  }

  return notFound();
}
