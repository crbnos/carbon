// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RunType } from "@carbon/database/run-type";
import {
  Button,
  DatePicker,
  RecordOutlet,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { endOfMonth, parseDate } from "@internationalized/date";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCirclePlus } from "react-icons/lu";
import { useNavigate } from "react-router";
import { Confirm } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import RevenueRecognitionRunsTable, {
  type RevenueRecognitionRunListItem
} from "./RevenueRecognitionRunsTable";
import { RUN_PAGES } from "./runPages";

type PeriodRunsPageProps = {
  /** Which runs the page lists and creates. */
  type: RunType;
  data: RevenueRecognitionRunListItem[];
  count: number;
  nextPeriodEnd: string;
  hasDraftBlocking: boolean;
};

/** The list of one run type with its New Run confirm. */
export default function PeriodRunsPage({
  type,
  data,
  count,
  nextPeriodEnd,
  hasDraftBlocking
}: PeriodRunsPageProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const confirmModal = useDisclosure();
  // The modal proposes the next period but lets the user pick another month
  // end: a first run made late, or a period skipped on purpose. Runs are
  // monthly, so any picked date snaps to its month end — the date the confirm
  // text names is the one the run gets.
  // Only the user's pick is state; until they pick, the proposed period shows.
  const [pickedPeriodEnd, setPeriodEnd] = useState<string | null>(null);
  const periodEnd = pickedPeriodEnd ?? nextPeriodEnd;

  const { listPath, newPath } = RUN_PAGES[type];
  const canCreate =
    permissions.can("create", "accounting") && !hasDraftBlocking;

  return (
    <VStack spacing={0} className="h-full">
      <RevenueRecognitionRunsTable
        type={type}
        data={data}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      leftIcon={<LuCirclePlus />}
                      variant="primary"
                      onClick={confirmModal.onOpen}
                      isDisabled={!canCreate}
                    >
                      {t`New Run`}
                    </Button>
                  </span>
                </TooltipTrigger>
                {hasDraftBlocking && (
                  <TooltipContent>
                    {t`A draft run must be posted or deleted first.`}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )
        }
      />

      <Confirm
        action={newPath}
        isOpen={confirmModal.isOpen}
        title={t`New Run`}
        text={
          type === "Lease"
            ? t`This will create a draft lease run for the period ending ${formatDate(periodEnd)}. Every lease and rental schedule row due on or before that date will be included.`
            : t`This will create a draft revenue recognition run for the period ending ${formatDate(periodEnd)}. Every schedule row due on or before that date will be included.`
        }
        confirmText={t`Create Run`}
        onCancel={confirmModal.onClose}
        onSubmit={() => {
          confirmModal.onClose();
          navigate(listPath);
        }}
        details={
          <div className="flex flex-col gap-2 pt-4">
            <span className="text-sm font-medium">{t`Period end`}</span>
            <DatePicker
              aria-label={t`Period end`}
              value={parseDate(periodEnd)}
              onChange={(value) => {
                if (value) setPeriodEnd(endOfMonth(value).toString());
              }}
            />
          </div>
        }
      >
        <input type="hidden" name="periodEnd" value={periodEnd} />
      </Confirm>

      <RecordOutlet />
    </VStack>
  );
}
