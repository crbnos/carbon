// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { postingOrThrow } from "@carbon/api/postings.server";
import { getJobDatabaseClient } from "../../../db";
import { inngest } from "../../client";

/**
 * The capacity part of a sales order line's delivery date check, out of the
 * request: a line save or a quote conversion marks the line `Pending` and
 * sends this event. The posting re-reads the lines, runs the shop schedule
 * simulation and writes the result, so a stale or repeated event only checks
 * the lines again. One order at a time, so two checks of one line never race.
 */
export const salesOrderDeliveryDateCheckFunction = inngest.createFunction(
  {
    id: "sales-order-delivery-date-check",
    retries: 2,
    // Out of retries: answer the lines by their lead time, so none stays
    // Pending (a spinner) for good.
    onFailure: async ({ event }) => {
      const { companyId, salesOrderId, lineIds, userId, save } =
        event.data.event.data;
      await postingOrThrow(
        "check-sales-order-delivery-dates",
        { db: getJobDatabaseClient(), companyId, userId },
        { salesOrderId, lineIds, capacity: "skip", save }
      );
    },
    concurrency: {
      limit: 1,
      key: '"sales-order-delivery-date:" + event.data.salesOrderId'
    }
  },
  { event: "carbon/sales-order.delivery-date-check" },
  async ({ event, step }) => {
    const { companyId, salesOrderId, lineIds, userId, save } = event.data;
    return step.run("check", () =>
      postingOrThrow(
        "check-sales-order-delivery-dates",
        { db: getJobDatabaseClient(), companyId, userId },
        { salesOrderId, lineIds, capacity: "run", save }
      )
    );
  }
);
