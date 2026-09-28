import { describe, expect, it, vi } from "vitest";

// production.service's module graph transitively loads @carbon/glossary, whose
// module-load-time Lingui `msg` macros aren't transformed under plain vitest and
// throw. The functions under test need none of it, so stub glossary; the real
// implementations stay under test.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

// The module graph also pulls @carbon/onboarding, whose content builds Lingui
// `msg` descriptors at module load — the macro isn't transformed under plain
// vitest, so raw `msg` throws. Stub it to a plain string builder so the content
// evaluates without the compiler.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : String(strings)
}));

const {
  planAssemblyStepMarkerSync,
  planAssemblyStepMarkerRemap,
  planOrphanStepAdoption,
  maxToolQuantityByItem,
  buildAssemblyToolStepLinks,
  duplicateJobOperationStep
} = await import("./production.service");

// ── Assembly → BoP sync: marker reconciliation ───────────────────────────────
describe("planAssemblyStepMarkerSync", () => {
  it("maps existing synced steps by their source marker (update targets)", () => {
    const { targetIdBySourceId } = planAssemblyStepMarkerSync(
      ["src-1", "src-2"],
      [
        { id: "job-1", assemblyInstructionStepId: "src-1" },
        { id: "job-2", assemblyInstructionStepId: "src-2" }
      ]
    );
    expect(targetIdBySourceId.get("src-1")).toBe("job-1");
    expect(targetIdBySourceId.get("src-2")).toBe("job-2");
  });

  it("leaves a brand-new source unmapped (insert target)", () => {
    const { targetIdBySourceId, staleTargetIds } = planAssemblyStepMarkerSync(
      ["src-1", "src-new"],
      [{ id: "job-1", assemblyInstructionStepId: "src-1" }]
    );
    expect(targetIdBySourceId.has("src-new")).toBe(false);
    expect(staleTargetIds).toEqual([]);
  });

  it("marks a synced step whose source was removed as stale (delete target)", () => {
    const { staleTargetIds } = planAssemblyStepMarkerSync(
      ["src-1"],
      [
        { id: "job-1", assemblyInstructionStepId: "src-1" },
        { id: "job-2", assemblyInstructionStepId: "src-removed" }
      ]
    );
    expect(staleTargetIds).toEqual(["job-2"]);
  });
});

// ── Assembly version activation: marker remap across versions ────────────────
describe("planAssemblyStepMarkerRemap", () => {
  it("maps a v1 step id to the v2 step copied from it", () => {
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "v1a", rootStepId: null }],
      [{ id: "v2a", rootStepId: "v1a" }]
    );
    expect(remap.get("v1a")).toBe("v2a");
  });

  it("maps across three versions via the flat root chain", () => {
    // v3 copied from v2 still roots at v1.
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "v2a", rootStepId: "v1a" }],
      [{ id: "v3a", rootStepId: "v1a" }]
    );
    expect(remap.get("v2a")).toBe("v3a");
  });

  it("maps regardless of reordering", () => {
    const remap = planAssemblyStepMarkerRemap(
      [
        { id: "v1a", rootStepId: null },
        { id: "v1b", rootStepId: null }
      ],
      [
        { id: "v2b", rootStepId: "v1b" },
        { id: "v2a", rootStepId: "v1a" }
      ]
    );
    expect(remap.get("v1a")).toBe("v2a");
    expect(remap.get("v1b")).toBe("v2b");
  });

  it("leaves a deleted step unmapped", () => {
    const remap = planAssemblyStepMarkerRemap(
      [
        { id: "v1a", rootStepId: null },
        { id: "v1gone", rootStepId: null }
      ],
      [{ id: "v2a", rootStepId: "v1a" }]
    );
    expect(remap.get("v1a")).toBe("v2a");
    expect(remap.has("v1gone")).toBe(false);
  });

  it("ignores a step added in the new version", () => {
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "v1a", rootStepId: null }],
      [
        { id: "v2a", rootStepId: "v1a" },
        { id: "v2new", rootStepId: null }
      ]
    );
    expect(remap.size).toBe(1);
  });

  it("collapses every old version in the group onto the new step", () => {
    // activateAssemblyInstructionVersion passes ALL sibling versions as
    // otherVersionIds, so oldSteps can span v1 AND v2 while v3 is activated.
    // Both collapse to the same target; harmless only because an operation's
    // markers all come from ONE version, so at most one entry matches a row.
    const remap = planAssemblyStepMarkerRemap(
      [
        { id: "v1a", rootStepId: null },
        { id: "v2a", rootStepId: "v1a" }
      ],
      [{ id: "v3a", rootStepId: "v1a" }]
    );
    expect(remap.get("v1a")).toBe("v3a");
    expect(remap.get("v2a")).toBe("v3a");
  });

  it("does not map a step to itself", () => {
    const remap = planAssemblyStepMarkerRemap(
      [{ id: "same", rootStepId: null }],
      [{ id: "same", rootStepId: null }]
    );
    expect(remap.size).toBe(0);
  });
});

// ── Assembly → BoP sync: reclaiming orphaned (null-marker) steps ─────────────
describe("planOrphanStepAdoption", () => {
  it("adopts an orphan matching a source step on sortOrder and name", () => {
    const adoption = planOrphanStepAdoption(
      [{ id: "src1", title: "Fit cover", sortOrder: 1 }],
      [{ id: "orphan1", name: "Fit cover", sortOrder: 1 }],
      new Set()
    );
    expect(adoption.get("orphan1")).toBe("src1");
  });

  it("ignores an orphan whose name differs", () => {
    const adoption = planOrphanStepAdoption(
      [{ id: "src1", title: "Fit cover", sortOrder: 1 }],
      [{ id: "handmade", name: "Operator note", sortOrder: 1 }],
      new Set()
    );
    expect(adoption.size).toBe(0);
  });

  it("does not claim a source step an existing marked step already owns", () => {
    const adoption = planOrphanStepAdoption(
      [{ id: "src1", title: "Fit cover", sortOrder: 1 }],
      [{ id: "orphan1", name: "Fit cover", sortOrder: 1 }],
      new Set(["src1"])
    );
    expect(adoption.size).toBe(0);
  });

  it("adopts a null-titled source step via its positional placeholder name", () => {
    // The sync writes name = title || `Step ${index + 1}`, so a null title
    // becomes "Step 1" on the job step. Comparing against the raw title would
    // never match and would insert a duplicate instead of healing.
    const adoption = planOrphanStepAdoption(
      [{ id: "src1", title: null, sortOrder: 1 }],
      [{ id: "orphan1", name: "Step 1", sortOrder: 1 }],
      new Set()
    );
    expect(adoption.get("orphan1")).toBe("src1");
  });

  it("uses the source's own index for the placeholder name", () => {
    const adoption = planOrphanStepAdoption(
      [
        { id: "src1", title: "Real title", sortOrder: 1 },
        { id: "src2", title: null, sortOrder: 2 }
      ],
      [{ id: "orphan2", name: "Step 2", sortOrder: 2 }],
      new Set()
    );
    expect(adoption.get("orphan2")).toBe("src2");
  });

  it("adopts each orphan at most once", () => {
    const adoption = planOrphanStepAdoption(
      [
        { id: "src1", title: "Same", sortOrder: 1 },
        { id: "src2", title: "Same", sortOrder: 1 }
      ],
      [{ id: "orphan1", name: "Same", sortOrder: 1 }],
      new Set()
    );
    expect(adoption.size).toBe(1);
  });
});

// ── Assembly → BoP sync: tool quantity ratchet ───────────────────────────────
describe("maxToolQuantityByItem", () => {
  it("takes the max quantity any step asks for, defaulting null to 1", () => {
    const max = maxToolQuantityByItem([
      { itemId: "T1", quantity: 1 },
      { itemId: "T1", quantity: 3 },
      { itemId: "T2", quantity: null }
    ]);
    expect(max.get("T1")).toBe(3);
    expect(max.get("T2")).toBe(1);
  });
});

// ── Assembly → BoP sync: tool step links (orphan contract) ────────────────────
describe("buildAssemblyToolStepLinks", () => {
  const sourceSteps = [{ id: "src-1" }, { id: "src-2" }];
  const targetIdBySource = new Map([
    ["src-1", "job-1"],
    ["src-2", "job-2"]
  ]);

  it("links each step's tools to its synced target step", () => {
    const links = buildAssemblyToolStepLinks(
      sourceSteps,
      new Map([
        ["src-1", [{ itemId: "T1" }]],
        ["src-2", [{ itemId: "T2" }]]
      ]),
      new Map([
        ["T1", "row-T1"],
        ["T2", "row-T2"]
      ]),
      targetIdBySource
    );
    expect(links).toEqual([
      { jobOperationToolId: "row-T1", jobOperationStepId: "job-1" },
      { jobOperationToolId: "row-T2", jobOperationStepId: "job-2" }
    ]);
  });

  it("produces NO link for a tool dropped from every source step — its jobOperationTool row (never deleted) becomes operation-level, shown on every step", () => {
    // T2 still has a jobOperationTool row from a prior sync (in toolRowIdByItemId)
    // but no source step references it anymore. The rebuilt links must omit it.
    const links = buildAssemblyToolStepLinks(
      sourceSteps,
      new Map([["src-1", [{ itemId: "T1" }]]]),
      new Map([
        ["T1", "row-T1"],
        ["T2", "row-T2"]
      ]),
      targetIdBySource
    );
    expect(links).toEqual([
      { jobOperationToolId: "row-T1", jobOperationStepId: "job-1" }
    ]);
    expect(links.some((l) => l.jobOperationToolId === "row-T2")).toBe(false);
  });
});

// ── duplicateJobOperationStep: link-carrying copy ────────────────────────────
// A tiny fake supabase client: canned rows for selects, records inserts. Only
// the chain shapes these functions use are supported (.select/.eq/.single, bare
// await, .insert(...).select("id").single(), bare-await .insert(...)).
function makeFakeClient(opts: {
  rows: Record<string, Record<string, unknown>[]>;
  newIdByTable?: Record<string, string>;
  errorOnInsert?: string;
}) {
  const inserts: { table: string; rows: Record<string, unknown>[] }[] = [];

  function resolve(state: {
    table: string;
    op?: "insert";
    filters: Record<string, unknown>;
    insertRows?: Record<string, unknown>[];
    single: boolean;
  }) {
    if (state.op === "insert") {
      inserts.push({ table: state.table, rows: state.insertRows ?? [] });
      if (opts.errorOnInsert === state.table) {
        return {
          data: null,
          error: { message: `insert failed: ${state.table}` }
        };
      }
      if (state.single) {
        const id = opts.newIdByTable?.[state.table] ?? `new_${state.table}`;
        return { data: { id }, error: null };
      }
      return { data: null, error: null };
    }
    let data = opts.rows[state.table] ?? [];
    for (const [col, val] of Object.entries(state.filters)) {
      data = data.filter((r) => r[col] === val);
    }
    return state.single
      ? { data: data[0] ?? null, error: null }
      : { data, error: null };
  }

  function builder(table: string) {
    const state = {
      table,
      filters: {} as Record<string, unknown>,
      op: undefined as "insert" | undefined,
      insertRows: undefined as Record<string, unknown>[] | undefined,
      single: false
    };
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return b;
      },
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        state.op = "insert";
        state.insertRows = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      single: () => {
        state.single = true;
        return Promise.resolve(resolve(state));
      },
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(state)).then(onF, onR)
    };
    return b;
  }

  return { client: { from: builder } as never, inserts };
}

describe("duplicateJobOperationStep", () => {
  function sourceRows() {
    return {
      jobOperationStep: [
        {
          id: "step-1",
          operationId: "op-1",
          name: "Attach bracket",
          description: null,
          type: "Task",
          unitOfMeasureCode: null,
          minValue: null,
          maxValue: null,
          listValues: null,
          sortOrder: 1
        },
        { id: "step-2", operationId: "op-1", sortOrder: 3 }
      ],
      jobOperationStepSlide: [
        {
          stepId: "step-1",
          imagePath: "/a.png",
          modelUploadId: null,
          caption: "c",
          sortOrder: 1,
          size: "medium",
          annotations: "[]"
        }
      ],
      jobOperationToolStep: [
        { jobOperationToolId: "tool-1", jobOperationStepId: "step-1" }
      ],
      jobMaterialStep: [
        { jobMaterialId: "mat-1", jobOperationStepId: "step-1", quantity: 5 }
      ]
    };
  }

  it("copies the step and carries its slides/tool-links/material-links onto the clone", async () => {
    const { client, inserts } = makeFakeClient({
      rows: sourceRows(),
      newIdByTable: { jobOperationStep: "step-new" }
    });

    const result = await duplicateJobOperationStep(client, {
      id: "step-1",
      companyId: "c1",
      createdBy: "u1"
    });
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ id: "step-new" });

    const stepInsert = inserts.find((i) => i.table === "jobOperationStep");
    expect(stepInsert?.rows[0]).toMatchObject({
      operationId: "op-1",
      name: "Attach bracket (copy)",
      sortOrder: 4, // max sibling sortOrder (3) + 1
      companyId: "c1",
      createdBy: "u1"
    });

    // Every child is repointed at the clone.
    expect(
      inserts.find((i) => i.table === "jobOperationStepSlide")?.rows[0]
    ).toMatchObject({
      stepId: "step-new",
      imagePath: "/a.png",
      companyId: "c1"
    });
    expect(
      inserts.find((i) => i.table === "jobOperationToolStep")?.rows
    ).toEqual([
      { jobOperationToolId: "tool-1", jobOperationStepId: "step-new" }
    ]);
    expect(inserts.find((i) => i.table === "jobMaterialStep")?.rows).toEqual([
      { jobMaterialId: "mat-1", jobOperationStepId: "step-new", quantity: 5 }
    ]);
  });

  it("aborts and surfaces the error if copying a child link fails (no further inserts)", async () => {
    const { client, inserts } = makeFakeClient({
      rows: sourceRows(),
      newIdByTable: { jobOperationStep: "step-new" },
      errorOnInsert: "jobOperationStepSlide"
    });

    const result = await duplicateJobOperationStep(client, {
      id: "step-1",
      companyId: "c1",
      createdBy: "u1"
    });

    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    // The slide copy failed, so the tool/material link copies must never run.
    expect(inserts.some((i) => i.table === "jobOperationToolStep")).toBe(false);
    expect(inserts.some((i) => i.table === "jobMaterialStep")).toBe(false);
  });
});
