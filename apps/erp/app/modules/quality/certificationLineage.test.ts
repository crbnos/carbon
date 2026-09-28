import { describe, expect, it } from "vitest";
import type {
  CertificationLineageRow,
  LineageEdge
} from "./certificationLineage";
import { dedupeLineageRows, findReceivedRoots } from "./certificationLineage";

// A fixture lineage graph: child entity id → the entities it came from.
function fetcherFor(
  graph: Record<string, { id: string; receiptLine?: string }[]>
) {
  const calls: string[][] = [];
  const fetchAncestors = async (ids: string[]): Promise<LineageEdge[]> => {
    calls.push(ids);
    return ids.flatMap((sourceEntityId) =>
      (graph[sourceEntityId] ?? []).map((parent) => ({
        sourceEntityId,
        id: parent.id,
        attributes: parent.receiptLine
          ? { Receipt: "rcpt-1", "Receipt Line": parent.receiptLine }
          : { "Split From Entity ID": "x" }
      }))
    );
  };
  return { fetchAncestors, calls };
}

function row(
  overrides: Partial<CertificationLineageRow>
): CertificationLineageRow {
  return {
    kind: "Material",
    name: "Ti-6Al-4V Bar",
    specification: null,
    supplierId: null,
    supplierName: null,
    certificateId: null,
    certificateNumber: null,
    documentId: null,
    receiptLineId: null,
    jobOperationId: null,
    trackedEntityIds: [],
    missing: false,
    ...overrides
  };
}

describe("findReceivedRoots", () => {
  it("walks a serial back through a split child to the received lot (depth 2)", async () => {
    // serial ← consumed split child ← received parent lot
    const { fetchAncestors } = fetcherFor({
      serial: [{ id: "splitChild" }],
      splitChild: [{ id: "receivedLot", receiptLine: "rl-1" }]
    });

    const roots = await findReceivedRoots(
      [{ id: "serial", attributes: null }],
      fetchAncestors
    );

    expect([...roots.entries()]).toEqual([["rl-1", ["receivedLot"]]]);
  });

  it("terminates on a cycle", async () => {
    const { fetchAncestors, calls } = fetcherFor({
      a: [{ id: "b" }],
      b: [{ id: "a" }]
    });

    const roots = await findReceivedRoots(
      [{ id: "a", attributes: null }],
      fetchAncestors
    );

    expect(roots.size).toBe(0);
    expect(calls).toEqual([["a"], ["b"]]);
  });

  it("treats a start entity that was itself received as a root", async () => {
    const { fetchAncestors, calls } = fetcherFor({});

    const roots = await findReceivedRoots(
      [{ id: "lot", attributes: { "Receipt Line": "rl-9" } }],
      fetchAncestors
    );

    expect([...roots.entries()]).toEqual([["rl-9", ["lot"]]]);
    expect(calls).toEqual([]);
  });
});

describe("dedupeLineageRows", () => {
  it("merges rows of one certificate and missing rows of one receipt line", () => {
    const rows = dedupeLineageRows([
      row({ certificateId: "cert-1", trackedEntityIds: ["lot-a"] }),
      row({ certificateId: "cert-1", trackedEntityIds: ["lot-b", "lot-a"] }),
      row({ missing: true, receiptLineId: "rl-2", trackedEntityIds: ["x"] }),
      row({ missing: true, receiptLineId: "rl-2", trackedEntityIds: ["y"] }),
      row({ missing: true, name: "Anodize", kind: "Special Process" })
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.trackedEntityIds).toEqual(["lot-a", "lot-b"]);
    expect(rows[1]?.trackedEntityIds).toEqual(["x", "y"]);
    expect(rows[2]?.name).toBe("Anodize");
  });
});
