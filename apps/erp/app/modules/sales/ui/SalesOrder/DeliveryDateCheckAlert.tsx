// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Spinner
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import { LuCalendarX } from "react-icons/lu";
import { Input } from "~/components/Form";
import { path } from "~/utils/path";

const logger = getLogger("erp", "delivery-date-check-alert");

// The line types the server checks (sales.service DELIVERY_CHECKED_LINE_TYPES).
const CHECKED_LINE_TYPES = new Set(["Part", "Material", "Tool", "Consumable"]);
const LINE_METHODS = new Set([
  "Pull from Inventory",
  "Make to Order",
  "Purchase to Order"
]);

type DeliveryDateCheck = {
  status: "Met" | "Missed";
  constraint: "Lead Time" | "Stock" | "Capacity" | null;
  earliestDate: string | null;
  leadTimeDays: number;
  freeQuantity: number | null;
  cause: string | null;
};

type DeliveryDateCheckAlertProps = {
  orderId: string;
  lineId?: string;
  lineType: string;
  itemId: string;
  methodType: string;
  quantity: number;
  locationId: string;
  promisedDate: string | null;
  /** the reason saved with an earlier kept date */
  defaultReason?: string | null;
  onUseEarliestDate: (date: string) => void;
};

/**
 * Checks the line's promised date as the user edits it (spec "UI Changes"
 * item 3). It warns and offers the earliest date; it never blocks the save.
 * Saving with the warning shown keeps the date, and the server records who
 * kept it, with the optional reason below.
 */
export function DeliveryDateCheckAlert({
  orderId,
  lineId,
  lineType,
  itemId,
  methodType,
  quantity,
  locationId,
  promisedDate,
  defaultReason,
  onUseEarliestDate
}: DeliveryDateCheckAlertProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [check, setCheck] = useState<DeliveryDateCheck | null>(null);
  const [loading, setLoading] = useState(false);

  const checkable =
    CHECKED_LINE_TYPES.has(lineType) &&
    LINE_METHODS.has(methodType) &&
    Boolean(itemId) &&
    Boolean(promisedDate) &&
    quantity > 0;

  useEffect(() => {
    if (!checkable || !promisedDate) {
      setCheck(null);
      return;
    }
    // A plain fetch, not a fetcher: a fetcher's action would revalidate every
    // loader of the order page on each change.
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(path.to.salesOrderDeliveryDate(orderId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            salesOrderLineId: lineId ?? null,
            salesOrderLineType: lineType,
            itemId,
            locationId: locationId || null,
            methodType,
            saleQuantity: quantity,
            promisedDate: promisedDate.slice(0, 10)
          }),
          signal: controller.signal
        });
        const body = (await response.json()) as {
          data?: { result: DeliveryDateCheck | null } | null;
          error?: { message?: string } | null;
        };
        if (body.error) {
          logger.error("Delivery date check refused", { error: body.error });
        }
        setCheck(body.data?.result ?? null);
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.error("Delivery date check failed", { error });
        setCheck(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    checkable,
    orderId,
    lineId,
    lineType,
    itemId,
    methodType,
    quantity,
    locationId,
    promisedDate
  ]);

  if (!checkable) return null;
  if (loading && !check) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="h-3 w-3" />
        <Trans>Checking the delivery date…</Trans>
      </div>
    );
  }
  if (check?.status !== "Missed" || !check.earliestDate) return null;

  const promised = formatDate(promisedDate, undefined, locale);
  const earliest = formatDate(check.earliestDate, undefined, locale);
  const days = check.leadTimeDays;
  const free = check.freeQuantity ?? 0;

  let message: string;
  if (check.constraint === "Stock") {
    message = t`Only ${free} are free by ${promised}. The earliest delivery date is ${earliest}.`;
  } else if (check.constraint === "Capacity") {
    message = t`The shop cannot finish this by ${promised}. The earliest delivery date is ${earliest}.`;
  } else {
    message = t`The lead time is ${days} days. The earliest delivery date is ${earliest}.`;
  }

  return (
    <Alert variant="warning" className="w-full">
      <LuCalendarX className="h-4 w-4" />
      <AlertTitle>
        <Trans>This date cannot be met</Trans>
      </AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3">
          <span>{message}</span>
          {check.constraint === "Capacity" && check.cause && (
            <span className="text-xs text-muted-foreground">{check.cause}</span>
          )}
          <div>
            <Button
              variant="secondary"
              size="sm"
              isLoading={loading}
              onClick={() => onUseEarliestDate(check.earliestDate!)}
            >
              <Trans>Use {earliest}</Trans>
            </Button>
          </div>
          <Input
            name="deliveryDateOverrideReason"
            label={t`Reason for keeping this date`}
            helperText={t`Optional. Saving keeps the date and records who kept it.`}
            defaultValue={defaultReason ?? undefined}
          />
        </div>
      </AlertDescription>
    </Alert>
  );
}
