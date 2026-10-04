// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

"use client";

import { DateTimePicker, Hidden, Submit, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import {
  formatDateTimeInZone,
  formatRelativeCalendarDays
} from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toCalendarDate,
  toCalendarDateTime,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import { setClockOutValidator } from "~/services/models";
import { path } from "~/utils/path";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const CLOCK_STORAGE_KEY = "timeclock-warning-ack";

type TimeCardWarningProps = {
  openClockEntry: {
    id: string;
    clockIn: string;
  } | null;
};

export function TimeCardWarning({ openClockEntry }: TimeCardWarningProps) {
  const { t } = useLingui();
  const { locale } = useLocale();
  const [showClockWarning, setShowClockWarning] = useState(false);
  const fetcher = useAction({
    onSettled: (data) => {
      if (data) {
        if ((data as { success?: boolean }).success) {
          toast.success(t`Updated successfully`);
          setShowClockWarning(false);
        }
      }
    }
  });

  useEffect(() => {
    if (!openClockEntry) {
      setShowClockWarning(false);
      return;
    }

    const checkStale = () => {
      const elapsed = Date.now() - new Date(openClockEntry.clockIn).getTime();
      if (elapsed < TWELVE_HOURS_MS) {
        setShowClockWarning(false);
        return;
      }

      const acked = sessionStorage.getItem(CLOCK_STORAGE_KEY);
      if (acked === openClockEntry.id) {
        setShowClockWarning(false);
        return;
      }

      setShowClockWarning(true);
    };

    checkStale();
    const interval = setInterval(checkStale, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [openClockEntry]);

  const handleClockAcknowledge = () => {
    if (openClockEntry) {
      sessionStorage.setItem(CLOCK_STORAGE_KEY, openClockEntry.id);
    }
    setShowClockWarning(false);
  };

  if (showClockWarning && openClockEntry) {
    const hoursElapsed = Math.floor(
      (Date.now() - new Date(openClockEntry.clockIn).getTime()) / 3600000
    );
    const timeZone = getLocalTimeZone();
    const clockedInAt = parseAbsolute(openClockEntry.clockIn, timeZone);
    const clockedInLabel = formatDateTimeInZone(
      openClockEntry.clockIn,
      timeZone,
      locale,
      {
        dateStyle: undefined,
        timeStyle: undefined,
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }
    );
    const clockedInDaysAgo = formatRelativeCalendarDays(
      toCalendarDate(clockedInAt).toString(),
      today(timeZone).toString(),
      locale
    );

    return (
      <Modal
        // No onOpenChange: the prompt must be answered, so it has no close button.
        open
      >
        <ModalContent>
          <ModalHeader>
            <ModalTitle>
              <Trans>Forgot to Clock Out?</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                You've been clocked in for {hoursElapsed} hours. Did you forget
                to clock out?
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ValidatedForm
            validator={setClockOutValidator}
            method="post"
            action={path.to.timecard}
            fetcher={fetcher}
          >
            <ModalBody>
              <VStack spacing={4}>
                <div className="flex w-full flex-col gap-1 rounded-lg border bg-muted/40 px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    <Trans>Clocked in</Trans>
                  </span>
                  <span className="text-sm font-medium">{clockedInLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    {clockedInDaysAgo}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    Set the time you stopped working, or acknowledge that you're
                    still working.
                  </Trans>
                </p>
                <Hidden name="intent" value="clockOut" />
                <DateTimePicker
                  name="clockOut"
                  label={t`Clock out`}
                  minValue={toCalendarDateTime(clockedInAt)}
                  maxValue={toCalendarDateTime(now(timeZone))}
                />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={handleClockAcknowledge}>
                <Trans>I'm Still Working</Trans>
              </Button>
              <Submit>
                <Trans>Set Clock Out</Trans>
              </Submit>
            </ModalFooter>
          </ValidatedForm>
        </ModalContent>
      </Modal>
    );
  }

  return null;
}
