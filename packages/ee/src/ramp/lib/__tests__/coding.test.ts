import { describe, expect, it } from "vitest";
import { codeSelections, RAMP_COST_CENTER_FIELD_ID } from "../coding";

const glAccount = (externalId: string) => ({
  external_id: externalId,
  category_info: { type: "GL_ACCOUNT", external_id: "gl-account" }
});

// A custom field has no `type` at creation, so Ramp reports its selections as
// OTHER — the field is recognised by its external id, never by the type enum.
const carbonCostCenter = (externalId: string) => ({
  external_id: externalId,
  category_info: { type: "OTHER", external_id: RAMP_COST_CENTER_FIELD_ID }
});

describe("codeSelections", () => {
  it("resolves the GL account from a native GL_ACCOUNT selection", () => {
    expect(codeSelections([glAccount("acct_travel")])).toEqual({
      accountId: "acct_travel",
      costCenterId: null
    });
  });

  it("resolves the cost center from Carbon's custom field even though it is typed OTHER", () => {
    expect(
      codeSelections([glAccount("acct_travel"), carbonCostCenter("cc_apollo")])
    ).toEqual({ accountId: "acct_travel", costCenterId: "cc_apollo" });
  });

  it("ignores a native COST_CENTER selection that is not Carbon's field", () => {
    // Ramp's own cost-center concept — its option ids are not Carbon ids.
    const native = {
      external_id: "ramp-native-cc",
      category_info: { type: "COST_CENTER", external_id: "ramp-cost-center" }
    };
    expect(codeSelections([glAccount("acct_travel"), native])).toEqual({
      accountId: "acct_travel",
      costCenterId: null
    });
  });

  it("first selection wins for each field", () => {
    expect(
      codeSelections([
        glAccount("acct_first"),
        glAccount("acct_second"),
        carbonCostCenter("cc_first"),
        carbonCostCenter("cc_second")
      ])
    ).toEqual({ accountId: "acct_first", costCenterId: "cc_first" });
  });

  it("skips selections without an external id", () => {
    expect(
      codeSelections([
        { external_id: null, category_info: { type: "GL_ACCOUNT" } },
        { category_info: { external_id: RAMP_COST_CENTER_FIELD_ID } }
      ])
    ).toEqual({ accountId: null, costCenterId: null });
  });

  it("falls back to the legacy top-level type for the GL account", () => {
    expect(
      codeSelections([{ external_id: "acct_x", type: "GL_ACCOUNT" }])
    ).toEqual({
      accountId: "acct_x",
      costCenterId: null
    });
  });

  it("handles a missing list", () => {
    expect(codeSelections(null)).toEqual({
      accountId: null,
      costCenterId: null
    });
    expect(codeSelections(undefined)).toEqual({
      accountId: null,
      costCenterId: null
    });
  });
});
