import { openai } from "@ai-sdk/openai";
import { getLogger } from "@carbon/logger";
import { openAiCategorizationModel } from "@carbon/utils";
import { generateObject } from "ai";
import { z } from "zod";
import type {
  AccountMatchProposal,
  ProviderChartAccount
} from "./account-mapping";

/**
 * LLM-assisted account matching. Given the Carbon accounts still awaiting a
 * provider mapping and the provider's chart of accounts, ask gpt-4o for a
 * best-guess pairing so the user isn't mapping every row by hand.
 *
 * Deliberately a pure function over already-loaded lists (no DB access): the
 * route passes the unmapped Carbon accounts and the provider chart it already
 * fetched for the Account Mapping tab. Nothing is written here — the returned
 * proposals are reviewed and confirmed through the same
 * `bulk-upsert-account-mappings` path the Match-by-code drawer uses.
 *
 * Best-effort: any failure (missing API key, model error, malformed output)
 * resolves to an empty proposal list with the error surfaced, never throws.
 */

const logger = getLogger("ee", "account-mapping-ai");

const aiMatchSchema = z.object({
  matches: z
    .array(
      z.object({
        accountId: z
          .string()
          .describe("The id of the Carbon account being mapped"),
        externalId: z
          .string()
          .describe(
            "The id of the provider account that best matches, or an empty string if none is a confident match"
          )
      })
    )
    .describe("One entry per Carbon account you can confidently match")
});

export async function suggestAccountMatchesWithAI(args: {
  accounts: Array<{ id: string; number: string | null; name: string }>;
  providerAccounts: ProviderChartAccount[];
}): Promise<{ data: AccountMatchProposal[] | null; error: string | null }> {
  const { accounts, providerAccounts } = args;

  if (accounts.length === 0 || providerAccounts.length === 0) {
    return { data: [], error: null };
  }

  try {
    const carbonList = accounts
      .map(
        (account) =>
          `${account.id} | ${account.number ?? "(no number)"} | ${account.name}`
      )
      .join("\n");

    const providerList = providerAccounts
      .map(
        (account) =>
          `${account.id} | ${account.code ?? "(no code)"} | ${account.name ?? "(no name)"}`
      )
      .join("\n");

    const { object } = await generateObject({
      model: openai(openAiCategorizationModel),
      schema: aiMatchSchema,
      prompt: `You are mapping a manufacturing ERP's general-ledger accounts to an external accounting system's chart of accounts. For each Carbon account, pick the single best matching provider account.

Match on the account's purpose — use the account number/code and name. A close number match is a strong signal, but the name's meaning matters most (e.g. "Accounts Receivable" should map to the provider's receivables account even if the numbers differ). Only return a match when you are reasonably confident; if no provider account is a good fit, return an empty string for externalId. Never invent ids — every id you return must come verbatim from the lists below.

Each row is formatted as: id | number/code | name

Carbon accounts to map:
${carbonList}

Provider chart of accounts:
${providerList}`,
      temperature: 0.2
    });

    const proposals = buildAiAccountProposals({
      matches: object.matches,
      accounts,
      providerAccounts
    });

    return { data: proposals, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Failed to suggest account matches with AI", { error });
    return { data: null, error };
  }
}

/**
 * Turn the model's raw {accountId, externalId} guesses into confirmable
 * proposals. Pure so it can be unit-tested without the LLM. Guards:
 * - drops empty externalId (the model's "no confident match" signal)
 * - drops hallucinated ids not present in the inputs
 * - one proposal per Carbon account (first guess wins)
 * externalCode/externalName are resolved from the provider account so the
 * confirm step stores the same display metadata the manual path does.
 */
export function buildAiAccountProposals(args: {
  matches: Array<{ accountId: string; externalId: string }>;
  accounts: Array<{ id: string; number: string | null; name: string }>;
  providerAccounts: ProviderChartAccount[];
}): AccountMatchProposal[] {
  const accountById = new Map(
    args.accounts.map((account) => [account.id, account])
  );
  const providerById = new Map(
    args.providerAccounts.map((account) => [account.id, account])
  );

  const proposals: AccountMatchProposal[] = [];
  const usedAccountIds = new Set<string>();

  for (const match of args.matches) {
    if (!match.externalId) continue;
    const account = accountById.get(match.accountId);
    const provider = providerById.get(match.externalId);
    if (!account || !provider) continue;
    if (usedAccountIds.has(account.id)) continue;
    usedAccountIds.add(account.id);

    proposals.push({
      accountId: account.id,
      accountNumber: account.number ?? "",
      accountName: account.name,
      externalId: provider.id,
      externalCode: provider.code ?? "",
      externalName: provider.name ?? null
    });
  }

  return proposals;
}
