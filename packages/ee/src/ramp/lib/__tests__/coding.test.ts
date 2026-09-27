import { describe, expect, it } from "vitest";
import {
  buildLineCodingSelections,
  codeSelections,
  RAMP_COST_CENTER_FIELD_ID,
  RAMP_GL_ACCOUNT_FIELD_ID,
  RAMP_PROJECT_FIELD_ID
} from "../coding";

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

const carbonProject = (externalId: string) => ({
  external_id: externalId,
  category_info: { type: "OTHER", external_id: RAMP_PROJECT_FIELD_ID }
});

describe("codeSelections", () => {
  it("resolves the GL account from a native GL_ACCOUNT selection", () => {
    expect(codeSelections([glAccount("acct_travel")])).toEqual({
      accountId: "acct_travel",
      costCenterId: null,
      projectId: null
    });
  });

  it("resolves the cost center from Carbon's custom field even though it is typed OTHER", () => {
    expect(
      codeSelections([glAccount("acct_travel"), carbonCostCenter("cc_apollo")])
    ).toEqual({
      accountId: "acct_travel",
      costCenterId: "cc_apollo",
      projectId: null
    });
  });

  it("resolves the project from Carbon's custom project field (typed OTHER)", () => {
    expect(
      codeSelections([glAccount("acct_travel"), carbonProject("prj_apollo")])
    ).toEqual({
      accountId: "acct_travel",
      costCenterId: null,
      projectId: "prj_apollo"
    });
  });

  it("resolves account, cost center, and project together", () => {
    expect(
      codeSelections([
        glAccount("acct_travel"),
        carbonCostCenter("cc_apollo"),
        carbonProject("prj_apollo")
      ])
    ).toEqual({
      accountId: "acct_travel",
      costCenterId: "cc_apollo",
      projectId: "prj_apollo"
    });
  });

  it("ignores a native COST_CENTER selection that is not Carbon's field", () => {
    // Ramp's own cost-center concept — its option ids are not Carbon ids.
    const native = {
      external_id: "ramp-native-cc",
      category_info: { type: "COST_CENTER", external_id: "ramp-cost-center" }
    };
    expect(codeSelections([glAccount("acct_travel"), native])).toEqual({
      accountId: "acct_travel",
      costCenterId: null,
      projectId: null
    });
  });

  it("first selection wins for each field", () => {
    expect(
      codeSelections([
        glAccount("acct_first"),
        glAccount("acct_second"),
        carbonCostCenter("cc_first"),
        carbonCostCenter("cc_second"),
        carbonProject("prj_first"),
        carbonProject("prj_second")
      ])
    ).toEqual({
      accountId: "acct_first",
      costCenterId: "cc_first",
      projectId: "prj_first"
    });
  });

  it("skips selections without an external id", () => {
    expect(
      codeSelections([
        { external_id: null, category_info: { type: "GL_ACCOUNT" } },
        { category_info: { external_id: RAMP_COST_CENTER_FIELD_ID } },
        { category_info: { external_id: RAMP_PROJECT_FIELD_ID } }
      ])
    ).toEqual({ accountId: null, costCenterId: null, projectId: null });
  });

  it("falls back to the legacy top-level type for the GL account", () => {
    expect(
      codeSelections([{ external_id: "acct_x", type: "GL_ACCOUNT" }])
    ).toEqual({
      accountId: "acct_x",
      costCenterId: null,
      projectId: null
    });
  });

  it("handles a missing list", () => {
    expect(codeSelections(null)).toEqual({
      accountId: null,
      costCenterId: null,
      projectId: null
    });
    expect(codeSelections(undefined)).toEqual({
      accountId: null,
      costCenterId: null,
      projectId: null
    });
  });
});

describe("buildLineCodingSelections (outbound write shape)", () => {
  const pushed = {
    pushedAccountIds: new Set(["acct_travel"]),
    pushedCostCenterIds: new Set(["cc_apollo"]),
    pushedProjectIds: new Set(["prj_apollo"])
  };

  it("codes the GL account, cost center, and project when all are pushed", () => {
    expect(
      buildLineCodingSelections(
        {
          accountId: "acct_travel",
          costCenterId: "cc_apollo",
          projectId: "prj_apollo"
        },
        pushed
      )
    ).toEqual([
      {
        field_external_id: RAMP_GL_ACCOUNT_FIELD_ID,
        field_option_external_id: "acct_travel"
      },
      {
        field_external_id: RAMP_COST_CENTER_FIELD_ID,
        field_option_external_id: "cc_apollo"
      },
      {
        field_external_id: RAMP_PROJECT_FIELD_ID,
        field_option_external_id: "prj_apollo"
      }
    ]);
  });

  it("omits an account/cost center/project Carbon has not pushed (fail-soft, never 422)", () => {
    expect(
      buildLineCodingSelections(
        {
          accountId: "acct_unknown",
          costCenterId: "cc_unknown",
          projectId: "prj_unknown"
        },
        pushed
      )
    ).toEqual([]);
  });

  it("codes only the pushed sides when the others are null or unpushed", () => {
    expect(
      buildLineCodingSelections(
        { accountId: "acct_travel", costCenterId: null, projectId: null },
        pushed
      )
    ).toEqual([
      {
        field_external_id: RAMP_GL_ACCOUNT_FIELD_ID,
        field_option_external_id: "acct_travel"
      }
    ]);
  });

  it("is round-trip consistent with codeSelections' read shape for the project", () => {
    // What we WRITE for a project should READ back as that same project.
    const selections = buildLineCodingSelections(
      { accountId: null, costCenterId: null, projectId: "prj_apollo" },
      pushed
    );
    const selection = selections[0];
    expect(
      codeSelections([
        {
          external_id: selection!.field_option_external_id,
          category_info: {
            type: "OTHER",
            external_id: selection!.field_external_id
          }
        }
      ]).projectId
    ).toBe("prj_apollo");
  });
});
