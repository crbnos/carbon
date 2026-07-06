import { describe, expect, it } from "vitest";
import { translateLegacyInspectionSavePayload } from "./inspectionDocumentSave.server";

describe("translateLegacyInspectionSavePayload", () => {
  it("maps combined balloon+anchor create to feature and geometry create", () => {
    const result = translateLegacyInspectionSavePayload(
      {
        create: [
          {
            tempId: "temp-a1",
            pageNumber: 1,
            xCoordinate: 0.1,
            yCoordinate: 0.2,
            width: 0.05,
            height: 0.04
          }
        ],
        update: [],
        delete: []
      },
      {
        create: [
          {
            tempBalloonAnchorId: "temp-a1",
            label: "1",
            xCoordinate: 0.15,
            yCoordinate: 0.25,
            description: "Diameter",
            nominalValue: "10",
            tolerancePlus: "0.1",
            toleranceMinus: "0.1",
            unit: "mm"
          }
        ],
        update: [],
        delete: []
      }
    );

    expect(result.features.create).toHaveLength(1);
    expect(result.features.create[0]).toMatchObject({
      tempId: "temp-a1",
      label: "1",
      description: "Diameter",
      unit: "mm"
    });
    expect(result.balloons.create).toHaveLength(1);
    expect(result.balloons.create[0]).toMatchObject({
      tempInspectionFeatureId: "temp-a1",
      tempBalloonAnchorId: "temp-a1",
      regionX: 0.1,
      xCoordinate: 0.15
    });
  });

  it("creates anchor-only rows as feature with default label", () => {
    const result = translateLegacyInspectionSavePayload(
      {
        create: [
          {
            tempId: "temp-anchor-only",
            pageNumber: 2,
            xCoordinate: 0,
            yCoordinate: 0,
            width: 0.1,
            height: 0.1
          }
        ],
        update: [],
        delete: []
      },
      { create: [], update: [], delete: [] }
    );

    expect(result.features.create).toEqual([
      expect.objectContaining({
        tempId: "temp-anchor-only",
        label: "0",
        pageNumber: 2
      })
    ]);
    expect(result.balloons.create).toHaveLength(1);
  });
});
