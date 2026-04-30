"use client";

import {
  Button,
  Input,
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
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
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
  const [editClockOut, setEditClockOut] = useState("");
  const fetcher = useFetcher();

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

  useEffect(() => {
    if (fetcher.data && fetcher.state === "idle") {
      if ((fetcher.data as { success?: boolean }).success) {
        toast.success(t`Updated successfully`);
        setShowClockWarning(false);
      }
    }
  }, [fetcher.data, fetcher.state, t]);

  const handleClockAcknowledge = () => {
    if (openClockEntry) {
      sessionStorage.setItem(CLOCK_STORAGE_KEY, openClockEntry.id);
    }
    setShowClockWarning(false);
  };

  const handleEditClockOut = () => {
    if (!editClockOut || !openClockEntry) return;
    const formData = new FormData();
    formData.append("intent", "clockOut");
    formData.append("clockOut", new Date(editClockOut).toISOString());
    fetcher.submit(formData, {
      method: "post",
      action: path.to.timecard
    });
  };

  if (showClockWarning && openClockEntry) {
    const hoursElapsed = Math.floor(
      (Date.now() - new Date(openClockEntry.clockIn).getTime()) / 3600000
    );

    return (
      <Modal
        open
        onOpenChange={() => {
          /* intentionally non-dismissable */
        }}
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
          <ModalBody>
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  You clocked in at{" "}
                  {new Date(openClockEntry.clockIn).toLocaleString(locale)}. You
                  can edit your clock-out time below or acknowledge that you're
                  still working.
                </Trans>
              </p>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  <Trans>Set clock-out time</Trans>
                </label>
                <Input
                  type="datetime-local"
                  value={editClockOut}
                  onChange={(e) => setEditClockOut(e.target.value)}
                />
              </div>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={handleClockAcknowledge}>
              <Trans>I'm Still Working</Trans>
            </Button>
            <Button
              onClick={handleEditClockOut}
              isDisabled={!editClockOut || fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              <Trans>Set Clock Out</Trans>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    );
  }

  return null;
}
