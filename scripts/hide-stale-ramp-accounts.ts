/**
 * Hide Ramp GL accounts that Carbon no longer knows about.
 *
 * Ramp keys an uploaded GL account on the `id` Carbon pushes — which is
 * `account.id`, NOT the account number. So whenever Carbon's chart of accounts
 * is regenerated with fresh ids (a dev reset/re-seed, a restore that re-mints
 * ids), Ramp sees an entirely new set and keeps the old one alongside it.
 * Nothing supersedes or removes the previous upload, so the coder's "Accounting
 * Category" dropdown accumulates one identical code+name entry per generation.
 *
 * "Stale" here means: the Ramp account's `id` is not a live Carbon `account.id`
 * for this company's group. That is the only safe discriminator — code and name
 * are identical across generations, which is the whole problem.
 *
 * Ramp has no DELETE for GL accounts; `visibility: "HIDDEN"` is the supported
 * removal, and it is what `pushChartOfAccounts` already uses. It is reversible
 * (PATCH back to VISIBLE).
 *
 * Usage:
 *   pnpm exec tsx scripts/hide-stale-ramp-accounts.ts <companyId>           # dry run
 *   pnpm exec tsx scripts/hide-stale-ramp-accounts.ts <companyId> --apply
 */

import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getRampIntegration } from "@carbon/ee/ramp.server";

const companyId = process.argv[2];
const apply = process.argv.includes("--apply");

if (!companyId) {
  console.error(
    "Usage: tsx scripts/hide-stale-ramp-accounts.ts <companyId> [--apply]"
  );
  process.exit(1);
}

async function main() {
  const serviceRole = getCarbonServiceRole();
  const integration = await getRampIntegration(serviceRole, companyId);
  if (!integration) throw new Error(`No Ramp integration for ${companyId}`);
  const { client } = integration;

  const { data: company, error: companyError } = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  if (companyError || !company?.companyGroupId) {
    throw new Error(
      `Failed to resolve company group: ${companyError?.message ?? "none"}`
    );
  }

  // The live chart of accounts is group-scoped (`account` has no companyId).
  const { data: accounts, error: accountsError } = await serviceRole
    .from("account")
    .select("id")
    .eq("companyGroupId", company.companyGroupId);
  if (accountsError) {
    throw new Error(`Failed to load accounts: ${accountsError.message}`);
  }
  const liveIds = new Set((accounts ?? []).map((a) => a.id));
  if (liveIds.size === 0) {
    throw new Error(
      "Carbon reports ZERO accounts for this group — refusing to hide anything, " +
        "since that would mark the entire Ramp chart of accounts stale."
    );
  }

  const remote: Array<Record<string, unknown>> = [];
  for await (const page of client.listAccountingAccounts()) remote.push(...page);

  const stale = remote.filter((a) => !liveIds.has(String(a.id)));
  const targets = stale.filter((a) => a.visibility !== "HIDDEN");
  const current = remote.length - stale.length;

  console.log(`live Carbon accounts     : ${liveIds.size}`);
  console.log(`Ramp GL accounts         : ${remote.length}`);
  console.log(`  current (keep)         : ${current}`);
  console.log(`  stale                  : ${stale.length}`);
  console.log(`  stale & still VISIBLE  : ${targets.length}  <- to hide`);

  // Safety net, stated against the only thing that matters: every code Carbon
  // CURRENTLY pushes must still have a visible account in Ramp afterwards.
  //
  // Deliberately NOT "every code that exists in Ramp keeps a survivor" — a code
  // whose Carbon account has since been deleted (7020/7030 here) legitimately
  // goes dark, and guarding on the remote code set would block the cleanup for
  // exactly the accounts it most needs to remove.
  const keptCodes = new Set(
    remote
      .filter((a) => liveIds.has(String(a.id)) && a.visibility !== "HIDDEN")
      .map((a) => String(a.code ?? ""))
  );
  const { data: liveNumbers } = await serviceRole
    .from("account")
    .select("number")
    .eq("companyGroupId", company.companyGroupId)
    .eq("isGroup", false)
    .eq("active", true);
  const orphaned = (liveNumbers ?? [])
    .map((r) => String(r.number ?? ""))
    .filter(
      (number) =>
        number &&
        // pushed before (some stale row carries this code) …
        stale.some((a) => String(a.code ?? "") === number) &&
        // … but nothing current would remain visible for it
        !keptCodes.has(number)
    );
  if (orphaned.length > 0) {
    throw new Error(
      `Refusing to run: ${orphaned.length} LIVE Carbon account code(s) would be ` +
        `left with no visible Ramp account (e.g. ${orphaned
          .slice(0, 5)
          .join(", ")}). Re-push the chart of accounts first.`
    );
  }

  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to hide them.");
    for (const a of targets.slice(0, 10)) {
      console.log(`  would hide ${a.code} ${a.name} (ramp_id=${a.ramp_id})`);
    }
    if (targets.length > 10) console.log(`  ... and ${targets.length - 10} more`);
    return;
  }

  let hidden = 0;
  const failures: string[] = [];
  for (const a of targets) {
    try {
      await client.patchAccountingAccount(String(a.ramp_id), {
        visibility: "HIDDEN"
      });
      hidden += 1;
      if (hidden % 25 === 0) console.log(`  hidden ${hidden}/${targets.length}`);
    } catch (err) {
      failures.push(
        `${a.code} ${a.name} (${a.ramp_id}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  console.log(`\nhidden: ${hidden}/${targets.length}`);
  if (failures.length) {
    console.log(`failures: ${failures.length}`);
    for (const f of failures.slice(0, 10)) console.log(`  ${f}`);
  }

  // Verify against Ramp rather than trusting the write loop.
  const after: Array<Record<string, unknown>> = [];
  for await (const page of client.listAccountingAccounts()) after.push(...page);
  const visible = after.filter((a) => a.visibility !== "HIDDEN");
  const byCode = new Map<string, number>();
  for (const a of visible) {
    const code = String(a.code ?? "(none)");
    byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  const dupes = [...byCode.entries()].filter(([, n]) => n > 1);
  console.log(`\nVERIFY: visible GL accounts now ${visible.length}`);
  console.log(`VERIFY: codes still appearing more than once: ${dupes.length}`);
  for (const [code, n] of dupes.slice(0, 10)) console.log(`  ${code} x${n}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
