// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
import { LuCalendarX } from "react-icons/lu";
import { useQuantityFormatter } from "~/hooks";
import {
  type DeliveryDateCheckLine,
  useDeliveryDateCheck
} from "./useDeliveryDateCheck";

type DeliveryDateCheckAlertProps = DeliveryDateCheckLine & {
  onUseEarliestDate: (date: string) => void;
};

/**
 * Shows the delivery date check of the line the form holds (spec "UI Changes"
 * item 3); `useDeliveryDateCheck` asks the server. It warns and offers the
 * earliest date; it never blocks the save. Saving with the warning shown keeps
 * the date, and the server records who kept it and when. A check that takes a
 * moment shows a spinner; at the Capacity level it says the shop's schedule is
 * checked.
 */
export function DeliveryDateCheckAlert({
  onUseEarliestDate,
  ...line
}: DeliveryDateCheckAlertProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const formatQuantity = useQuantityFormatter();
  const { checkable, control, check, failed, showSpinner } =
    useDeliveryDateCheck(line);

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
    if (failed) {
      return (
        <p className="text-xs text-muted-foreground">
          <Trans>Couldn't check the delivery date. You can still save.</Trans>
        </p>
      );
    }
    return null;
  }

  const promised = formatDate(line.promisedDate, undefined, locale);
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
                Free stock by {promised} is only {free}.
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
        </div>
      </AlertDescription>
    </Alert>
  );
}
