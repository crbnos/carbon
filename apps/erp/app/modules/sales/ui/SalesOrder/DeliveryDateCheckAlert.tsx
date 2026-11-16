// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Constants, type Database } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  cn,
  Spinner
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useRef, useState } from "react";
import { LuCalendarX } from "react-icons/lu";
import { useSpinDelay } from "spin-delay";
import { useQuantityFormatter } from "~/hooks";
import { DELIVERY_CHECKED_LINE_TYPES } from "~/modules/sales/sales.utils";
import { path } from "~/utils/path";

const logger = getLogger("erp", "delivery-date-check-alert");

// The form holds the method as text, empty until an item is chosen.
const LINE_METHODS: ReadonlySet<string> = new Set(
  Constants.public.Enums.methodType
);
// The check is sent once the user stops editing for this long.
const CHECK_DEBOUNCE_MS = 400;
// The spinner shows only for a request still running after this long, as the
// tables do (`useSpinDelay`), so a fast answer never flashes one.
const SPINNER_DELAY_MS = 300;

type Enums = Database["public"]["Enums"];
type DeliveryDateControl = Enums["deliveryDateControl"];

type DeliveryDateCheck = {
  status: Enums["deliveryDateStatus"];
  constraint: Enums["deliveryDateConstraint"] | null;
  earliestDate: string | null;
  leadTimeDays: number;
  freeQuantity: number | null;
  cause: string | null;
};

type DeliveryDateCheckAlertProps = {
  orderId: string;
  lineId?: string;
  lineType: Enums["salesOrderLineType"];
  itemId: string;
  methodType: string;
  quantity: number;
  locationId: string;
  promisedDate: string | null;
  onUseEarliestDate: (date: string) => void;
};

/**
 * Checks the line's promised date as the user edits it (spec "UI Changes"
 * item 3). It warns and offers the earliest date; it never blocks the save.
 * Saving with the warning shown keeps the date, and the server records who
 * kept it and when. A check that takes a moment shows a spinner; at the
 * Capacity level it says the shop's schedule is checked.
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
  onUseEarliestDate
}: DeliveryDateCheckAlertProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();
  const [check, setCheck] = useState<DeliveryDateCheck | null>(null);
  // A request is in flight. It turns on when the debounce sends the request,
  // never on the edit, so the spinner delay counts from the request.
  const [loading, setLoading] = useState(false);
  const showSpinner = useSpinDelay(loading, { delay: SPINNER_DELAY_MS });
  const [failed, setFailed] = useState(false);
  // The level each item has at each location, as the server last answered.
  // An item at the None level is not asked again.
  const controls = useRef(new Map<string, DeliveryDateControl>());
  const controlKey = `${itemId}:${locationId}`;
  const control = controls.current.get(controlKey);

  const checkable =
    DELIVERY_CHECKED_LINE_TYPES.has(lineType) &&
    LINE_METHODS.has(methodType) &&
    Boolean(itemId) &&
    Boolean(promisedDate) &&
    quantity > 0 &&
    control !== "None";

  useEffect(() => {
    if (!checkable || !promisedDate) {
      setCheck(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    // A plain fetch, not a fetcher: a fetcher's action would revalidate every
    // loader of the order page on each change.
    const controller = new AbortController();
    setFailed(false);
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
          data?: {
            control: DeliveryDateControl;
            result: DeliveryDateCheck | null;
          } | null;
          error?: { message?: string } | null;
        };
        if (controller.signal.aborted) return;
        if (body.error || !body.data) {
          logger.error("Delivery date check refused", { error: body.error });
          setFailed(true);
          setCheck(null);
        } else {
          controls.current.set(controlKey, body.data.control);
          setCheck(body.data.result);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        logger.error("Delivery date check failed", { error });
        setFailed(true);
        setCheck(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, CHECK_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
      setLoading(false);
    };
  }, [
    checkable,
    controlKey,
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

  const checkingText =
    control === "Capacity"
      ? t`Checking the shop's schedule…`
      : t`Checking the delivery date…`;

  const missed = check?.status === "Missed" && check.earliestDate;
  if (!missed) {
    if (showSpinner) {
      return (
        <div
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Spinner className="h-3 w-3" />
          {checkingText}
        </div>
      );
    }
    if (failed && !loading && !showSpinner) {
      return (
        <p className="text-xs text-muted-foreground">
          <Trans>Couldn't check the delivery date. You can still save.</Trans>
        </p>
      );
    }
    return null;
  }

  const promised = formatDate(promisedDate, undefined, locale);
  const earliest = formatDate(check.earliestDate, undefined, locale);
  const free = formatQuantity(check.freeQuantity ?? 0);
  const updating = showSpinner;

  return (
    <Alert
      variant="warning"
      className={cn("w-full transition-opacity", updating && "opacity-60")}
    >
      <LuCalendarX className="h-4 w-4" />
      <AlertTitle className="flex items-center gap-2">
        <Trans>This date cannot be met</Trans>
        {updating && (
          <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
            <Spinner className="h-3 w-3" />
            <Trans>Updating…</Trans>
          </span>
        )}
      </AlertTitle>
      <AlertDescription>
        <div className="flex flex-col gap-3">
          <span>
            {check.constraint === "Stock" ? (
              <Trans>
                Free stock by {promised}: {free}.
              </Trans>
            ) : check.constraint === "Capacity" ? (
              <Trans>The shop cannot finish this by {promised}.</Trans>
            ) : (
              <Plural
                value={check.leadTimeDays}
                one="The lead time is # day."
                other="The lead time is # days."
              />
            )}{" "}
            <Trans>The earliest delivery date is {earliest}.</Trans>
          </span>
          {check.constraint === "Capacity" && check.cause && (
            <span className="text-xs text-muted-foreground">{check.cause}</span>
          )}
          <div>
            <Button
              variant="secondary"
              size="sm"
              isDisabled={updating}
              onClick={() => onUseEarliestDate(check.earliestDate!)}
            >
              <Trans>Use {earliest}</Trans>
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            <Trans>Saving keeps this date and records who kept it.</Trans>
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
}
