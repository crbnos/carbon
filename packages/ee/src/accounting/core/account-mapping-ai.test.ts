import { describe, expect, it } from "vitest";
import { buildAiAccountProposals } from "./account-mapping-ai";

const accounts = [
  { id: "acc-ar", number: "1200", name: "Accounts Receivable" },
  { id: "acc-sales", number: "4000", name: "Sales Revenue" },
  { id: "acc-no-number", number: null, name: "Rounding" }
];

const providerAccounts = [
  { id: "p-ar", code: "1200", name: "Trade Debtors" },
  { id: "p-sales", code: "200", name: "Sales" },
  { id: "p-nameless", code: "999", name: null }
];

describe("buildAiAccountProposals", () => {
  it("resolves provider code/name from the provider account", () => {
    const proposals = buildAiAccountProposals({
      matches: [
        { accountId: "acc-ar", externalId: "p-ar" },
        { accountId: "acc-sales", externalId: "p-sales" }
      ],
      accounts,
      providerAccounts
    });

    expect(proposals).toEqual([
      {
        accountId: "acc-ar",
        accountNumber: "1200",
        accountName: "Accounts Receivable",
        externalId: "p-ar",
        externalCode: "1200",
        externalName: "Trade Debtors"
      },
      {
        accountId: "acc-sales",
        accountNumber: "4000",
        accountName: "Sales Revenue",
        externalId: "p-sales",
        externalCode: "200",
        externalName: "Sales"
      }
    ]);
  });

  it("drops matches with an empty externalId (no confident match)", () => {
    const proposals = buildAiAccountProposals({
      matches: [{ accountId: "acc-ar", externalId: "" }],
      accounts,
      providerAccounts
    });

    expect(proposals).toEqual([]);
  });

  it("drops hallucinated account or provider ids", () => {
    const proposals = buildAiAccountProposals({
      matches: [
        { accountId: "acc-ghost", externalId: "p-ar" },
        { accountId: "acc-ar", externalId: "p-ghost" }
      ],
      accounts,
      providerAccounts
    });

    expect(proposals).toEqual([]);
  });

  it("keeps only the first proposal per Carbon account", () => {
    const proposals = buildAiAccountProposals({
      matches: [
        { accountId: "acc-ar", externalId: "p-ar" },
        { accountId: "acc-ar", externalId: "p-sales" }
      ],
      accounts,
      providerAccounts
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.externalId).toBe("p-ar");
  });

  it("falls back to empty number and null name when absent", () => {
    const proposals = buildAiAccountProposals({
      matches: [{ accountId: "acc-no-number", externalId: "p-nameless" }],
      accounts,
      providerAccounts
    });

    expect(proposals[0]).toEqual({
      accountId: "acc-no-number",
      accountNumber: "",
      accountName: "Rounding",
      externalId: "p-nameless",
      externalCode: "999",
      externalName: null
    });
  });
});
