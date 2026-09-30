import type { Database } from "@carbon/database";
import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which party a memo journal belongs to. The memo's PARTY — not its direction —
 * decides whether the journal is gated by the Credit Memos or the Supplier
 * Credits family (`family: "per-party"` in POSTING_POLICY), so a supplier memo
 * in the Credit direction is a supplier credit, not an AR document.
 *
 * One definition, four call sites: the enqueue decision
 * (`planJournalPostingFromState`), the reconcile executor, and the `shouldSync`
 * backstop of all three provider journal-entry syncers. The two must never
 * disagree — an enqueue that says "push" followed by a backstop that resolves
 * no party parks a spurious `MEMO_PARTY_UNRESOLVED` Warning, and in `journals`
 * mode that is the whole memo family silently not reaching the provider.
 */
export type MemoParty = "customer" | "supplier" | null;

/** The only two `memo` columns the party decision reads. */
export type MemoPartyRow = {
  customerId: string | null;
  supplierId: string | null;
};

/**
 * The reads the resolution needs, already scoped to ONE company by whichever
 * adapter built it — the tenant scope is a construction-time invariant here, so
 * no implementation of the decision below can forget to apply it.
 */
export type MemoPartyLookup = {
  /**
   * The memo id carried on the journal's OWN lines
   * (`documentType = 'Memo'`, `documentId = memo.id`), or null when its lines
   * carry no memo link.
   */
  findMemoIdOnJournalLines(journalId: string): Promise<string | null>;
  /** The memo's party columns, by memo id. */
  findMemoById(memoId: string): Promise<MemoPartyRow | null>;
  /** The memo's party columns, by the memo's OWN `journalId`. */
  findMemoByJournalId(journalId: string): Promise<MemoPartyRow | null>;
};

/** A memo carries a customer XOR a supplier; neither means "unresolved". */
export function memoPartyFromRow(row: MemoPartyRow | null): MemoParty {
  if (!row) return null;
  if (row.customerId) return "customer";
  if (row.supplierId) return "supplier";
  return null;
}

/**
 * The one memo-party decision, over an already-tenant-scoped lookup.
 *
 * Resolved through the journal LINES first (`documentType = 'Memo'`,
 * `documentId = memo.id`), which the posting journal AND the VOID journal both
 * carry — the same link `loadChargePolicyInputs` uses, for the same reason.
 * Voiding a memo INSERTS A NEW journal (`post-memo-transaction.ts`) and leaves
 * `memo.journalId` pointing at the ORIGINAL, so keying on `memo.journalId`
 * alone resolved no memo at all for a void: the party came back null, the
 * policy parked a spurious `MEMO_PARTY_UNRESOLVED` Warning, and the void never
 * propagated to the provider.
 *
 * `memo.journalId` is kept only as a fallback, for a journal whose lines carry
 * no document link.
 */
export async function resolveMemoPartyFromLookup(
  lookup: MemoPartyLookup,
  journalId: string
): Promise<MemoParty> {
  const memoId = await lookup.findMemoIdOnJournalLines(journalId);
  const row = memoId
    ? await lookup.findMemoById(memoId)
    : await lookup.findMemoByJournalId(journalId);
  return memoPartyFromRow(row);
}

/** Kysely adapter — the provider syncers' `this.database`. */
export function memoPartyLookupFromDatabase(
  database: Kysely<KyselyDatabase>,
  companyId: string
): MemoPartyLookup {
  return {
    async findMemoIdOnJournalLines(journalId) {
      const line = await database
        .selectFrom("journalLine")
        .select("documentId")
        .where("companyId", "=", companyId)
        .where("journalId", "=", journalId)
        .where("documentType", "=", "Memo")
        .where("documentId", "is not", null)
        .limit(1)
        .executeTakeFirst();
      return line?.documentId ?? null;
    },
    async findMemoById(memoId) {
      return (
        (await database
          .selectFrom("memo")
          .select(["customerId", "supplierId"])
          .where("companyId", "=", companyId)
          .where("id", "=", memoId)
          .executeTakeFirst()) ?? null
      );
    },
    async findMemoByJournalId(journalId) {
      return (
        (await database
          .selectFrom("memo")
          .select(["customerId", "supplierId"])
          .where("companyId", "=", companyId)
          .where("journalId", "=", journalId)
          .executeTakeFirst()) ?? null
      );
    }
  };
}

/** supabase-js adapter — the Inngest enqueue/drain path's service-role client. */
export function memoPartyLookupFromClient(
  client: SupabaseClient<Database>,
  companyId: string
): MemoPartyLookup {
  return {
    async findMemoIdOnJournalLines(journalId) {
      const line = await client
        .from("journalLine")
        .select("documentId")
        .eq("companyId", companyId)
        .eq("journalId", journalId)
        .eq("documentType", "Memo")
        .not("documentId", "is", null)
        .limit(1)
        .maybeSingle();
      // A failed lines read is not "no memo" — fall through to the
      // `memo.journalId` fallback rather than guessing a party.
      return line.error ? null : (line.data?.documentId ?? null);
    },
    async findMemoById(memoId) {
      const memo = await client
        .from("memo")
        .select("customerId, supplierId")
        .eq("companyId", companyId)
        .eq("id", memoId)
        .maybeSingle();
      return memo.error ? null : (memo.data ?? null);
    },
    async findMemoByJournalId(journalId) {
      const memo = await client
        .from("memo")
        .select("customerId, supplierId")
        .eq("companyId", companyId)
        .eq("journalId", journalId)
        .maybeSingle();
      return memo.error ? null : (memo.data ?? null);
    }
  };
}

/** `resolveMemoPartyFromLookup` over a Kysely database (provider syncers). */
export async function resolveMemoJournalPartyFromDatabase(
  database: Kysely<KyselyDatabase>,
  args: { companyId: string; journalId: string }
): Promise<MemoParty> {
  return resolveMemoPartyFromLookup(
    memoPartyLookupFromDatabase(database, args.companyId),
    args.journalId
  );
}

/** `resolveMemoPartyFromLookup` over a supabase client (Inngest paths). */
export async function resolveMemoJournalPartyFromClient(
  client: SupabaseClient<Database>,
  args: { companyId: string; journalId: string }
): Promise<MemoParty> {
  return resolveMemoPartyFromLookup(
    memoPartyLookupFromClient(client, args.companyId),
    args.journalId
  );
}
