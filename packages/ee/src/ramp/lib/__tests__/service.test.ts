import { round } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { RAMP_COST_CENTER_FIELD_ID } from "../coding";
import {
  buildCostCenterFieldBody,
  buildCostCenterOptionsBody,
  chunk,
  costCenterFingerprint,
  diffChartOfAccounts,
  diffCostCenterOptions,
  isCodableAccount,
  RAMP_ACCOUNTS_BATCH_SIZE,
  type RampAccountMapping,
  type RampCostCenterMapping,
  rampClassificationForClass,
  scaleLinesToTotal,
  scaleRepaymentLines
} from "../service";

describe("rampClassificationForClass", () => {
  it("maps each Carbon GL class to its Ramp classification", () => {
    expect(rampClassificationForClass("Asset", false)).toBe("ASSET");
    expect(rampClassificationForClass("Liability", false)).toBe("LIABILITY");
    expect(rampClassificationForClass("Equity", false)).toBe("EQUITY");
    expect(rampClassificationForClass("Revenue", false)).toBe("REVENUE");
    expect(rampClassificationForClass("Expense", false)).toBe("EXPENSE");
  });

  it("maps the card-liability account to CREDCARD regardless of class", () => {
    expect(rampClassificationForClass("Liability", true)).toBe("CREDCARD");
    expect(rampClassificationForClass("Asset", true)).toBe("CREDCARD");
    expect(rampClassificationForClass(null, true)).toBe("CREDCARD");
    expect(rampClassificationForClass(undefined, true)).toBe("CREDCARD");
  });

  it("returns null for an account with no class (unclassifiable)", () => {
    expect(rampClassificationForClass(null, false)).toBeNull();
    expect(rampClassificationForClass(undefined, false)).toBeNull();
  });
});

describe("chunk", () => {
  it("splits into batches of at most the given size", () => {
    const items = Array.from({ length: 1250 }, (_, index) => index);
    const batches = chunk(items, RAMP_ACCOUNTS_BATCH_SIZE);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(500);
    expect(batches[1]).toHaveLength(500);
    expect(batches[2]).toHaveLength(250);
    // No item is dropped or duplicated.
    expect(batches.flat()).toEqual(items);
  });

  it("returns exactly one batch when the input fits", () => {
    expect(chunk([1, 2, 3], RAMP_ACCOUNTS_BATCH_SIZE)).toEqual([[1, 2, 3]]);
  });

  it("returns no batches for an empty input", () => {
    expect(chunk([], RAMP_ACCOUNTS_BATCH_SIZE)).toEqual([]);
  });

  it("throws when the batch size is not positive", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
  });
});

describe("scaleRepaymentLines", () => {
  it("scales a 3-line original to a partial repayment, putting the rounding residual on the largest line so the sum equals the header exactly", () => {
    const original = [
      { accountId: "a", amount: 10 },
      { accountId: "b", amount: 10 },
      { accountId: "c", amount: 13.33 }
    ];
    // ratio = 11.11 / 33.33 ≈ 0.33333 → 3.33, 3.33, 4.44 (sum 11.10), residual
    // 0.01 lands on the largest line (c → 4.45).
    const scaled = scaleRepaymentLines(original, 11.11, 33.33, 2);

    expect(scaled.map((line) => line.amount)).toEqual([3.33, 3.33, 4.45]);

    const sum = round(
      scaled.reduce((acc, line) => acc + line.amount, 0),
      2
    );
    expect(sum).toBe(11.11);
  });

  it("returns an empty list for no original lines", () => {
    expect(scaleRepaymentLines([], 5, 10, 2)).toEqual([]);
  });
});

describe("scaleLinesToTotal", () => {
  it("converts a single merchant-currency line to the settlement header total (foreign charge)", () => {
    // A CAD 608.98 charge that settled at USD 431.68 — the line comes in the
    // merchant currency and must be scaled to the settlement amount so it sums
    // to the header (post-card-transaction's invariant).
    const lines = [{ accountId: "adv", amount: 608.98 }];
    const scaled = scaleLinesToTotal(lines, 431.68, 2);
    expect(scaled.map((l) => l.amount)).toEqual([431.68]);
  });

  it("is a no-op when the lines already sum to the target (same-currency)", () => {
    const lines = [
      { accountId: "a", amount: 100 },
      { accountId: "b", amount: 50 }
    ];
    const scaled = scaleLinesToTotal(lines, 150, 2);
    expect(scaled.map((l) => l.amount)).toEqual([100, 50]);
  });

  it("scales multiple lines proportionally, residual on the largest so the sum is exact", () => {
    const lines = [
      { accountId: "a", amount: 10 },
      { accountId: "b", amount: 10 },
      { accountId: "c", amount: 13.33 }
    ];
    const scaled = scaleLinesToTotal(lines, 11.11, 2);
    expect(scaled.map((l) => l.amount)).toEqual([3.33, 3.33, 4.45]);
    const sum = round(
      scaled.reduce((acc, l) => acc + l.amount, 0),
      2
    );
    expect(sum).toBe(11.11);
  });

  it("preserves non-amount fields on each line", () => {
    const lines = [
      { accountId: "a", amount: 5, costCenterId: "cc1", description: "x" }
    ];
    const [scaled] = scaleLinesToTotal(lines, 10, 2);
    expect(scaled).toMatchObject({
      accountId: "a",
      amount: 10,
      costCenterId: "cc1",
      description: "x"
    });
  });

  it("degrades a zero raw-sum to the target on the largest line", () => {
    const lines = [
      { accountId: "a", amount: 0 },
      { accountId: "b", amount: 0 }
    ];
    const scaled = scaleLinesToTotal(lines, 7, 2);
    expect(
      round(
        scaled.reduce((acc, l) => acc + l.amount, 0),
        2
      )
    ).toBe(7);
  });

  it("returns an empty list for no lines", () => {
    expect(scaleLinesToTotal([], 5, 2)).toEqual([]);
  });
});

describe("diffChartOfAccounts", () => {
  // Must match accountFingerprint(): `${name} ${code ?? ""}|${visibility}`
  // (classification is not PATCHable in Ramp, so it is not tracked).
  const fp = (name: string, code: string, visible = true) =>
    `${name} ${code}|${visible ? "VISIBLE" : "HIDDEN"}`;

  const cash = {
    id: "acc_cash",
    name: "Cash",
    code: "1000",
    classification: "ASSET"
  };
  const ramp = {
    id: "acc_ramp",
    name: "Ramp Card",
    code: "2000",
    classification: "CREDCARD"
  };

  it("creates unmapped accounts", () => {
    const { toCreate, toUpdate } = diffChartOfAccounts([cash, ramp], []);
    expect(toCreate).toEqual([cash, ramp]);
    expect(toUpdate).toEqual([]);
  });

  it("skips a mapped account whose name/code are unchanged", () => {
    const mappings: RampAccountMapping[] = [
      {
        entityId: "acc_cash",
        externalId: "ramp_1",
        fingerprint: fp("Cash", "1000")
      }
    ];
    const { toCreate, toUpdate } = diffChartOfAccounts([cash], mappings);
    expect(toCreate).toEqual([]);
    expect(toUpdate).toEqual([]);
  });

  it("updates a mapped account whose name or code changed", () => {
    const mappings: RampAccountMapping[] = [
      {
        entityId: "acc_cash",
        externalId: "ramp_1",
        fingerprint: fp("Cash", "1000")
      }
    ];
    const renamed = { ...cash, name: "Operating Cash" };
    const { toCreate, toUpdate } = diffChartOfAccounts([renamed], mappings);
    expect(toCreate).toEqual([]);
    expect(toUpdate).toEqual([{ account: renamed, externalId: "ramp_1" }]);
  });

  it("does NOT update on a classification-only change (not PATCHable in Ramp)", () => {
    const mappings: RampAccountMapping[] = [
      {
        entityId: "acc_cash",
        externalId: "ramp_1",
        fingerprint: fp("Cash", "1000")
      }
    ];
    const reclassified = { ...cash, classification: "LIABILITY" };
    const { toCreate, toUpdate } = diffChartOfAccounts(
      [reclassified],
      mappings
    );
    expect(toCreate).toEqual([]);
    expect(toUpdate).toEqual([]);
  });

  it("falls back to the Carbon account id when the mapping has no externalId", () => {
    const mappings: RampAccountMapping[] = [
      { entityId: "acc_cash", externalId: null, fingerprint: "stale" }
    ];
    const { toUpdate } = diffChartOfAccounts([cash], mappings);
    expect(toUpdate).toEqual([{ account: cash, externalId: "acc_cash" }]);
  });
});

describe("cost-center field bodies", () => {
  it("creates the field keyed by Ramp's remote `id` with the dimension name as label", () => {
    expect(buildCostCenterFieldBody("Project")).toEqual({
      id: RAMP_COST_CENTER_FIELD_ID,
      name: "Project",
      display_name: "Project",
      input_type: "SINGLE_CHOICE",
      is_splittable: true
    });
  });

  it("uploads options against the field's ramp_id with the Carbon id in `id`", () => {
    expect(
      buildCostCenterOptionsBody("ramp-uuid", [
        { id: "cc_apollo", value: "Apollo" },
        { id: "cc_zeus", value: "Zeus" }
      ])
    ).toEqual({
      field_id: "ramp-uuid",
      options: [
        { id: "cc_apollo", value: "Apollo" },
        { id: "cc_zeus", value: "Zeus" }
      ]
    });
  });
});

describe("diffCostCenterOptions", () => {
  const apollo = { id: "cc_apollo", value: "Apollo" };
  const zeus = { id: "cc_zeus", value: "Zeus" };
  const remoteApollo = {
    id: "cc_apollo",
    ramp_id: "r_apollo",
    value: "Apollo",
    visibility: "VISIBLE"
  };
  const mapped = (
    id: string,
    rampId: string,
    value: string,
    visible = true
  ): RampCostCenterMapping => ({
    entityId: id,
    externalId: rampId,
    fingerprint: costCenterFingerprint({ value, visible })
  });

  it("creates cost centers Ramp does not have", () => {
    const diff = diffCostCenterOptions(
      [apollo, zeus],
      [remoteApollo],
      [mapped("cc_apollo", "r_apollo", "Apollo")]
    );
    expect(diff.toCreate).toEqual([zeus]);
    expect(diff.toRename).toEqual([]);
    expect(diff.toShow).toEqual([]);
    expect(diff.toHide).toEqual([]);
  });

  it("is a no-op when nothing changed since the last push", () => {
    const diff = diffCostCenterOptions(
      [apollo],
      [remoteApollo],
      [mapped("cc_apollo", "r_apollo", "Apollo")]
    );
    expect(diff).toEqual({
      toCreate: [],
      toRename: [],
      toShow: [],
      toHide: []
    });
  });

  it("renames when the Carbon name changed since Carbon last pushed it", () => {
    const renamed = { id: "cc_apollo", value: "Apollo II" };
    const diff = diffCostCenterOptions(
      [renamed],
      [remoteApollo],
      [mapped("cc_apollo", "r_apollo", "Apollo")]
    );
    expect(diff.toRename).toEqual([{ option: renamed, rampId: "r_apollo" }]);
  });

  it("leaves a Ramp-side rename alone when Carbon's name is unchanged", () => {
    const customerRenamed = { ...remoteApollo, display_name: "Apollo (Sales)" };
    const diff = diffCostCenterOptions(
      [apollo],
      [customerRenamed],
      [mapped("cc_apollo", "r_apollo", "Apollo")]
    );
    expect(diff.toRename).toEqual([]);
  });

  it("hides an option whose cost center is gone from Carbon, once", () => {
    const first = diffCostCenterOptions(
      [],
      [remoteApollo],
      [mapped("cc_apollo", "r_apollo", "Apollo")]
    );
    expect(first.toHide).toEqual([
      { id: "cc_apollo", value: "Apollo", rampId: "r_apollo" }
    ]);
    const again = diffCostCenterOptions(
      [],
      [{ ...remoteApollo, visibility: "HIDDEN" }],
      [mapped("cc_apollo", "r_apollo", "Apollo", false)]
    );
    expect(again.toHide).toEqual([]);
  });

  it("re-shows a restored cost center that Carbon had hidden", () => {
    const diff = diffCostCenterOptions(
      [apollo],
      [{ ...remoteApollo, visibility: "HIDDEN" }],
      [mapped("cc_apollo", "r_apollo", "Apollo", false)]
    );
    expect(diff.toShow).toEqual([{ option: apollo, rampId: "r_apollo" }]);
  });

  it("adopts an unmapped remote option, correcting only what disagrees", () => {
    const diff = diffCostCenterOptions(
      [apollo],
      [{ ...remoteApollo, value: "Apolo", visibility: "HIDDEN" }],
      []
    );
    expect(diff.toCreate).toEqual([]);
    expect(diff.toRename).toEqual([{ option: apollo, rampId: "r_apollo" }]);
    expect(diff.toShow).toEqual([{ option: apollo, rampId: "r_apollo" }]);
  });

  it("ignores remote rows without a ramp_id", () => {
    const diff = diffCostCenterOptions(
      [apollo],
      [{ id: "cc_apollo", value: "Apollo" }],
      []
    );
    expect(diff.toCreate).toEqual([apollo]);
  });
});

describe("isCodableAccount", () => {
  const card = {
    scope: "expense" as const,
    cardLiabilityAccountId: "acc_ramp"
  };

  it("keeps the picker to Expense accounts under the expense scope", () => {
    expect(isCodableAccount({ id: "a", class: "Expense" }, card)).toBe(true);
    expect(isCodableAccount({ id: "a", class: "Asset" }, card)).toBe(false);
    expect(isCodableAccount({ id: "a", class: "Liability" }, card)).toBe(false);
    expect(isCodableAccount({ id: "a", class: "Equity" }, card)).toBe(false);
    expect(isCodableAccount({ id: "a", class: "Revenue" }, card)).toBe(false);
    expect(isCodableAccount({ id: "a", class: null }, card)).toBe(false);
  });

  it("always keeps the card-liability account (Ramp needs its CREDCARD account)", () => {
    expect(isCodableAccount({ id: "acc_ramp", class: "Liability" }, card)).toBe(
      true
    );
  });

  it("exposes everything under the all scope", () => {
    const all = { scope: "all" as const, cardLiabilityAccountId: "acc_ramp" };
    expect(isCodableAccount({ id: "a", class: "Asset" }, all)).toBe(true);
    expect(isCodableAccount({ id: "a", class: "Revenue" }, all)).toBe(true);
  });
});

describe("diffChartOfAccounts visibility", () => {
  const fp = (name: string, code: string, visible = true) =>
    `${name} ${code}|${visible ? "VISIBLE" : "HIDDEN"}`;
  const cash = {
    id: "acc_cash",
    name: "Cash",
    code: "1000",
    classification: "ASSET"
  };

  it("does not create an account that should be hidden and was never pushed", () => {
    const { toCreate, toUpdate } = diffChartOfAccounts(
      [{ ...cash, visible: false }],
      []
    );
    expect(toCreate).toEqual([]);
    expect(toUpdate).toEqual([]);
  });

  it("updates (hides) an already-pushed account when it stops being codable", () => {
    const mappings: RampAccountMapping[] = [
      {
        entityId: "acc_cash",
        externalId: "ramp_1",
        fingerprint: fp("Cash", "1000")
      }
    ];
    const hidden = { ...cash, visible: false };
    const { toUpdate } = diffChartOfAccounts([hidden], mappings);
    expect(toUpdate).toEqual([{ account: hidden, externalId: "ramp_1" }]);
  });

  it("is a no-op once the hidden state has been pushed", () => {
    const mappings: RampAccountMapping[] = [
      {
        entityId: "acc_cash",
        externalId: "ramp_1",
        fingerprint: fp("Cash", "1000", false)
      }
    ];
    const { toCreate, toUpdate } = diffChartOfAccounts(
      [{ ...cash, visible: false }],
      mappings
    );
    expect(toCreate).toEqual([]);
    expect(toUpdate).toEqual([]);
  });
});
