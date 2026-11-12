// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  type RequiredScanMaterial,
  requiredScanMessage,
  unissuedTrackedMaterials
} from "./trackedMaterials";

const material = (
  overrides: Partial<RequiredScanMaterial> = {}
): RequiredScanMaterial => ({
  id: "jm_1",
  jobMakeMethodId: "jmm_1",
  jobOperationId: "op_2",
  requiresSerialTracking: true,
  requiresBatchTracking: false,
  quantity: 1,
  quantityIssued: 0,
  ...overrides
});

const args = (
  materials: RequiredScanMaterial[],
  overrides: Partial<Parameters<typeof unissuedTrackedMaterials>[0]> = {}
) => ({
  materials,
  operationId: "op_2",
  jobMakeMethodId: "jmm_1",
  isLastOperation: false,
  unitsAfterCompletion: 1,
  ...overrides
});

describe("unissuedTrackedMaterials", () => {
  it("requires a material with no operation at the last operation", () => {
    const unassigned = material({ jobOperationId: null });
    expect(
      unissuedTrackedMaterials(args([unassigned], { isLastOperation: true }))
    ).toEqual([unassigned]);
  });

  it("does not require a material with no operation before the last operation", () => {
    const unassigned = material({ jobOperationId: null });
    const otherOperation = material({ id: "jm_2", jobOperationId: "op_1" });
    expect(
      unissuedTrackedMaterials(args([unassigned, otherOperation]))
    ).toEqual([]);
  });

  it("ignores a material of another make method", () => {
    expect(
      unissuedTrackedMaterials(
        args([material({ jobMakeMethodId: "jmm_sub" })], {
          isLastOperation: true
        })
      )
    ).toEqual([]);
  });

  it("does not require a material that is fully issued", () => {
    expect(
      unissuedTrackedMaterials(
        args([material({ quantity: 2, quantityIssued: 2 })])
      )
    ).toEqual([]);
  });

  it("requires the quantity for every unit completed so far", () => {
    // 2 per unit, 2 units after this completion: 4 needed, 3 issued.
    const batch = material({
      requiresSerialTracking: false,
      requiresBatchTracking: true,
      quantity: 2,
      quantityIssued: 3
    });
    expect(
      unissuedTrackedMaterials(args([batch], { unitsAfterCompletion: 2 }))
    ).toEqual([batch]);
    expect(
      unissuedTrackedMaterials(
        args([{ ...batch, quantityIssued: 4 }], { unitsAfterCompletion: 2 })
      )
    ).toEqual([]);
  });
});

describe("requiredScanMessage", () => {
  it("returns null when nothing is missing", () => {
    expect(requiredScanMessage([])).toBeNull();
  });
});
