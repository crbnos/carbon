// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useLoaderQuery } from "@carbon/query";
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Plural, SelectOrdinal, Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuInfo, LuTriangleAlert } from "react-icons/lu";
import { useSpinDelay } from "spin-delay";
import { Hidden, NumberControlled, Submit } from "~/components/Form";
import {
  RENTAL_EARLY_INVOICE_MAX_PERIODS,
  rentalEarlyInvoiceValidator
} from "~/modules/sales/sales.models";
import type { loader } from "~/routes/api+/rental-agreement.$id.invoice-preview";
import { path } from "~/utils/path";
import RentalInvoiceLinesTable from "./RentalInvoiceLinesTable";
import RentalMoney from "./RentalMoney";
import type { RentalAgreement } from "./types";

// The table dims only for a preview still loading after this long, as the
// delivery date check does, so a fast answer never flickers.
const SPINNER_DELAY_MS = 300;

type RentalInvoiceModalProps = {
  open: boolean;
  onClose: () => void;
  rentalAgreement: RentalAgreement;
  /** 1 when a Pending period is left, else 0 (the due charges alone). */
  initialPeriods: number;
};

/** Invoice the next N periods of an Active agreement as one Draft invoice.
 *  The body sits inside `ModalContent`, so N starts over on each open. */
export default function RentalInvoiceModal({
  open,
  onClose,
  ...props
}: RentalInvoiceModalProps) {
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()}>
      <ModalOverlay />
      <ModalContent size="xxlarge">
        <RentalInvoiceBody {...props} onClose={onClose} />
      </ModalContent>
    </Modal>
  );
}

function RentalInvoiceBody({
  rentalAgreement,
  initialPeriods,
  onClose
}: Omit<RentalInvoiceModalProps, "open">) {
  const { t } = useLingui();
  const id = rentalAgreement.id!;
  const readableId = rentalAgreement.rentalAgreementId ?? "";
  const [periods, setPeriods] = useState(initialPeriods);

  // A read keyed by its URL: a new N loads a new preview, and the last one
  // stays on screen while it loads.
  const preview = useLoaderQuery<typeof loader>(
    path.to.api.rentalAgreementInvoicePreview(id, periods),
    { keepPreviousData: true }
  );
  // The shown preview may be for an earlier N; Create waits until it is for
  // this N, so the posted N and fromPeriodStart are the ones on screen.
  const isUpdating = preview.isFetching || preview.isPlaceholderData;
  const showSpinner = useSpinDelay(isUpdating, {
    delay: SPINNER_DELAY_MS
  });
  const invoice = preview.data?.data ?? null;
  const errorMessage = preview.data?.error?.message;
  // Null on an open-ended agreement, which bills at most 12 periods ahead.
  const remainingPeriods = invoice?.remainingPeriods;

  return (
    <ValidatedForm
      validator={rentalEarlyInvoiceValidator}
      method="post"
      action={path.to.rentalAgreementInvoice(id)}
      defaultValues={{ periods: initialPeriods }}
    >
      <ModalHeader>
        <ModalTitle>
          <Trans>Invoice {readableId}</Trans>
        </ModalTitle>
        <ModalDescription>
          <Trans>
            The invoice stays a draft. Nothing is posted or emailed.
          </Trans>
        </ModalDescription>
      </ModalHeader>
      <ModalBody>
        <Hidden
          name="fromPeriodStart"
          value={invoice?.firstPeriodStart ?? ""}
        />
        <VStack spacing={4}>
          <HStack className="w-full flex-wrap">
            <span className="text-sm">
              <Trans>Invoice the next</Trans>
            </span>
            <div className="w-28">
              <NumberControlled
                name="periods"
                aria-label={t`Periods to invoice`}
                value={periods}
                onChange={setPeriods}
                minValue={initialPeriods === 0 ? 0 : 1}
                maxValue={remainingPeriods ?? RENTAL_EARLY_INVOICE_MAX_PERIODS}
              />
            </div>
            <span className="text-sm">
              <Plural value={periods} one="period" other="periods" />
            </span>
            <BillingPeriodHelp
              billingCycle={rentalAgreement.billingCycle}
              startDate={rentalAgreement.startDate}
              isFixedTerm={typeof remainingPeriods === "number"}
            />
            {typeof remainingPeriods === "number" && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPeriods(remainingPeriods)}
              >
                <Trans>All remaining</Trans>
              </Button>
            )}
          </HStack>
          {periods === 0 && (
            <p className="text-sm text-muted-foreground">
              <Trans>
                No billing periods are left. Only what is due is drafted.
              </Trans>
            </p>
          )}
          {invoice && invoice.earlyReturnCredit > 0 && (
            <p className="text-sm text-muted-foreground">
              <Trans>
                A credit memo of{" "}
                <RentalMoney
                  value={invoice.earlyReturnCredit}
                  currencyCode={rentalAgreement.currencyCode}
                />{" "}
                for the early return is drafted too.
              </Trans>
            </p>
          )}
          {errorMessage ? (
            <Alert variant="destructive">
              <LuTriangleAlert />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : (
            invoice &&
            invoice.lines.length > 0 && (
              <div
                aria-busy={isUpdating}
                className={cn(
                  "w-full transition-opacity",
                  showSpinner && "opacity-50"
                )}
              >
                <RentalInvoiceLinesTable
                  lines={invoice.lines}
                  subtotal={invoice.subtotal}
                  totalTax={invoice.totalTax}
                  totalAmount={invoice.totalAmount}
                  currencyCode={rentalAgreement.currencyCode}
                />
              </div>
            )
          )}
        </VStack>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Submit isDisabled={!invoice || isUpdating} withBlocker={false}>
          <Trans>Create Draft Invoice</Trans>
        </Submit>
      </ModalFooter>
    </ValidatedForm>
  );
}

/** What one period is on this agreement's billing cycle. */
function BillingPeriodHelp({
  billingCycle,
  startDate,
  isFixedTerm
}: {
  billingCycle: RentalAgreement["billingCycle"];
  startDate: RentalAgreement["startDate"];
  isFixedTerm: boolean;
}) {
  const { t } = useLingui();
  if (!billingCycle) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t`What is a period?`}
          className="text-muted-foreground hover:text-foreground"
        >
          <LuInfo className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <VStack spacing={1}>
          <p>
            {billingCycle === "Monthly" ? (
              <MonthlyPeriod startDate={startDate} />
            ) : billingCycle === "Calendar Month" ? (
              <Trans>
                One period is a calendar month; the first and last can be part
                months.
              </Trans>
            ) : (
              <Trans>One period is 28 days.</Trans>
            )}
          </p>
          {isFixedTerm && (
            <p>
              <Trans>
                All remaining bills every period left in one invoice.
              </Trans>
            </p>
          )}
        </VStack>
      </TooltipContent>
    </Tooltip>
  );
}

function MonthlyPeriod({ startDate }: { startDate: string | null }) {
  const startDay = startDate ? parseDate(startDate).day : null;
  // Past the 28th a short month moves the day, so no example is given.
  if (startDay === null || startDay > 28) {
    return <Trans>One period is a month from the start date.</Trans>;
  }
  if (startDay === 1) {
    return (
      <Trans>
        One period is a month from the start date (the 1st to the end of the
        month).
      </Trans>
    );
  }
  const endDay = startDay - 1;
  return (
    <Trans>
      One period is a month from the start date (the{" "}
      <SelectOrdinal
        value={startDay}
        one="#st"
        two="#nd"
        few="#rd"
        other="#th"
      />{" "}
      to the{" "}
      <SelectOrdinal value={endDay} one="#st" two="#nd" few="#rd" other="#th" />
      ).
    </Trans>
  );
}
