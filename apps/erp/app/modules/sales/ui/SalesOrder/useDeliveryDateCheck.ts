// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Constants, type Database } from "@carbon/database";
import { RefreshRate, useLoaderQuery } from "@carbon/query";
import { useDebounce } from "@carbon/react";
import { useEffect, useRef, useState } from "react";
import { useSpinDelay } from "spin-delay";
import { DELIVERY_CHECKED_LINE_TYPES } from "~/modules/sales/sales.utils";
import type { loader } from "~/routes/api+/sales-order.$orderId.delivery-date";
import { path } from "~/utils/path";

type Enums = Database["public"]["Enums"];
export type DeliveryDateControl = Enums["deliveryDateControl"];

// The form holds the method as text, empty until an item is chosen.
const LINE_METHODS: ReadonlySet<string> = new Set(
  Constants.public.Enums.methodType
);
// The check is sent once the user stops editing for this long.
const CHECK_DEBOUNCE_MS = 400;
// The spinner shows only for a check still running after this long, as the
// tables do (`useSpinDelay`), so a fast answer never flashes one.
const SPINNER_DELAY_MS = 300;

export type DeliveryDateCheckLine = {
  orderId: string;
  lineId?: string;
  lineType: Enums["salesOrderLineType"];
  itemId: string;
  methodType: string;
  quantity: number;
  locationId: string;
  promisedDate: string | null;
};

/**
 * The delivery date check of the line the form holds: a cached read of
 * `api+/sales-order.$orderId.delivery-date`, sent 400 ms after the last edit.
 * The last answer stays while a new one loads. An item at the `None` level is
 * not asked again.
 */
export function useDeliveryDateCheck(line: DeliveryDateCheckLine) {
  // The level each item has at each location, as the server last answered.
  const controls = useRef(new Map<string, DeliveryDateControl>());
  const controlKey = `${line.itemId}:${line.locationId}`;
  const control = controls.current.get(controlKey);

  const checkable =
    DELIVERY_CHECKED_LINE_TYPES.has(line.lineType) &&
    LINE_METHODS.has(line.methodType) &&
    Boolean(line.itemId) &&
    Boolean(line.promisedDate) &&
    line.quantity > 0 &&
    control !== "None";

  const url =
    checkable && line.promisedDate
      ? path.to.api.salesOrderDeliveryDate(line.orderId, {
          salesOrderLineId: line.lineId ?? "",
          salesOrderLineType: line.lineType,
          itemId: line.itemId,
          locationId: line.locationId,
          methodType: line.methodType,
          saleQuantity: String(line.quantity),
          promisedDate: line.promisedDate.slice(0, 10)
        })
      : null;
  // The URL to ask, and the item and location it asks about, once the user
  // has stopped editing for CHECK_DEBOUNCE_MS.
  const [asked, setAsked] = useState({ url, controlKey });
  const debounceAsk = useDebounce(setAsked, CHECK_DEBOUNCE_MS);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `debounceAsk` is a new function on each render over the same timer, so only the line decides when to ask
  useEffect(() => {
    debounceAsk({ url, controlKey });
  }, [url, controlKey]);

  // A line that stops being checkable stops at once; only a new check waits.
  const query = useLoaderQuery<typeof loader>(url === null ? null : asked.url, {
    staleTime: RefreshRate.High,
    keepPreviousData: true
  });
  const answer = query.data?.data ?? null;

  // Learn the level from an answer to the asked URL, never from the previous
  // URL's answer the query shows while this one loads.
  useEffect(() => {
    if (!answer || query.isPlaceholderData) return;
    controls.current.set(asked.controlKey, answer.control);
  }, [answer, asked.controlKey, query.isPlaceholderData]);

  const showSpinner = useSpinDelay(query.isFetching, {
    delay: SPINNER_DELAY_MS
  });
  const failed = query.isError || Boolean(query.data?.error);

  return {
    checkable,
    control,
    check: failed ? null : (answer?.result ?? null),
    failed: failed && !query.isFetching,
    showSpinner
  };
}
