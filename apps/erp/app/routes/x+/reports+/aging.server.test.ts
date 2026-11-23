// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { agingExcelResponse } from "./aging.server";

describe("agingExcelResponse", () => {
  it.each([
    ["ar", 15, "I", "N", "F"],
    ["ap", 16, "J", "O", "G"]
  ] as const)(
    "writes editable formulas for %s totals",
    async (side, columnCount, firstBucket, lastBucket, originalAmount) => {
      const fields = Array.from({ length: columnCount }, (_, index) =>
        index === columnCount - 1 ? "Total" : `Column ${index + 1}`
      );
      const row = Array.from(
        { length: columnCount },
        () => "" as string | number
      );
      row[columnCount - 1] = 125;
      row[columnCount - 2] = -5;
      row[columnCount - 3] = 130;
      row[columnCount - 10] = 200;
      const response = await agingExcelResponse(
        `${side}-aging.xlsx`,
        { fields, rows: [row] },
        side
      );
      expect(response.headers.get("Content-Type")).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        Buffer.from(await response.arrayBuffer()) as unknown as Parameters<
          typeof workbook.xlsx.load
        >[0]
      );
      const sheet = workbook.getWorksheet(
        side === "ar" ? "AR Aging" : "AP Aging"
      );
      expect(sheet).toBeDefined();
      const worksheet = sheet!;
      expect(
        worksheet.getCell(`${worksheet.getColumn(columnCount).letter}2`).value
      ).toEqual({
        formula: `SUM(${firstBucket}2:${lastBucket}2)`,
        result: 125
      });
      expect(worksheet.getCell(`${originalAmount}3`).value).toEqual({
        formula: `SUM(${originalAmount}2:${originalAmount}2)`,
        result: 200
      });
      expect(worksheet.getCell(`${lastBucket}3`).value).toEqual({
        formula: `SUM(${lastBucket}2:${lastBucket}2)`,
        result: -5
      });
      expect(
        worksheet.getCell(`${worksheet.getColumn(columnCount).letter}3`).value
      ).toEqual({
        formula: `SUM(${worksheet.getColumn(columnCount).letter}2:${worksheet.getColumn(columnCount).letter}2)`,
        result: 125
      });
      expect(worksheet.getCell("A3").value).toBe("Total");
    }
  );
});
