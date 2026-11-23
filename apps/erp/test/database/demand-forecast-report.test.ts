// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect } from "vitest";
import { getDemandForecastReport } from "../../app/modules/production/production.service";
import { decodeCursor } from "../../app/utils/cursor";
import { alwaysPostFixture, USER } from "./fixtures/always-post";
import { databaseTest } from "./fixtures/local-database";

databaseTest(
  "forecast filters and cursor pages return dated rows in order",
  async () => {
    const f = await alwaysPostFixture();
    const dates = Array.from({ length: 103 }, (_, index) =>
      new Date(Date.UTC(2026, 0, index)).toISOString().slice(0, 10)
    );
    const periodIds = dates.map((_, index) => `${f.prefix}-period-${index}`);
    const projectionId = (index: number) => `${f.prefix}-projection-${index}`;
    const cursorKeys = [
      "demandForecastReport:v1",
      f.companyId,
      f.locationId,
      f.partId,
      dates[1],
      dates[101]
    ];

    try {
      await f.db
        .insertInto("period")
        .values(
          dates.map((date, index) => ({
            id: periodIds[index],
            startDate: date,
            endDate: date,
            periodType: "Day" as const
          }))
        )
        .execute();
      // Insert in reverse date order so the first page detects missing SQL ordering.
      await f.db
        .insertInto("demandProjection")
        .values([
          ...Array.from({ length: 101 }, (_, index) => 101 - index).map(
            (index) => ({
              id: projectionId(index),
              itemId: f.partId,
              locationId: f.locationId,
              periodId: periodIds[index],
              forecastQuantity: 25,
              consumedQuantity: 8,
              companyId: f.companyId,
              createdBy: USER,
              updatedBy: USER
            })
          ),
          ...[
            {
              id: "before",
              itemId: f.partId,
              locationId: f.locationId,
              periodId: periodIds[0]
            },
            {
              id: "after",
              itemId: f.partId,
              locationId: f.locationId,
              periodId: periodIds[102]
            },
            {
              id: "other-item",
              itemId: f.assemblyId,
              locationId: f.locationId,
              periodId: periodIds[1]
            },
            {
              id: "other-location",
              itemId: f.partId,
              locationId: f.otherLocationId,
              periodId: periodIds[1]
            }
          ].map((row) => ({
            ...row,
            id: `${f.prefix}-${row.id}`,
            forecastQuantity: 99,
            consumedQuantity: 0,
            companyId: f.companyId,
            createdBy: USER,
            updatedBy: USER
          }))
        ])
        .execute();

      const item = await f.db
        .selectFrom("item")
        .select(["readableIdWithRevision", "name", "unitOfMeasureCode"])
        .where("id", "=", f.partId)
        .executeTakeFirstOrThrow();
      const params = {
        companyId: f.companyId,
        locationId: f.locationId,
        itemId: f.partId,
        startDate: dates[1],
        endDate: dates[101],
        cursorKeys
      };
      const first = await getDemandForecastReport(f.db, params);
      expect(first.results.map((row) => row.startDate)).toEqual(
        dates.slice(1, 101)
      );
      expect(first.results[0]).toEqual({
        itemId: f.partId,
        item: item.readableIdWithRevision,
        itemName: item.name,
        unitOfMeasureCode: item.unitOfMeasureCode,
        startDate: dates[1],
        endDate: dates[1],
        forecastQuantity: 25,
        consumedQuantity: 8,
        remainingQuantity: 17
      });
      const cursor = decodeCursor(first.nextCursor);
      expect(cursor).toEqual({
        values: [dates[100], f.partId],
        id: projectionId(100),
        keys: cursorKeys
      });

      const second = await getDemandForecastReport(f.db, {
        ...params,
        after: {
          startDate: dates[100],
          itemId: f.partId,
          id: projectionId(100)
        }
      });
      expect(second).toEqual({
        results: [
          {
            itemId: f.partId,
            item: item.readableIdWithRevision,
            itemName: item.name,
            unitOfMeasureCode: item.unitOfMeasureCode,
            startDate: dates[101],
            endDate: dates[101],
            forecastQuantity: 25,
            consumedQuantity: 8,
            remainingQuantity: 17
          }
        ],
        nextCursor: null
      });
    } finally {
      try {
        await f.db
          .deleteFrom("demandProjection")
          .where("companyId", "=", f.companyId)
          .execute();
        await f.db
          .deleteFrom("period")
          .where("id", "in", periodIds)
          .execute();
      } finally {
        await f.cleanup();
      }
    }
  }
);
