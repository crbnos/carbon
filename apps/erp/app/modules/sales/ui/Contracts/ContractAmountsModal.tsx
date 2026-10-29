// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP, monthStart } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { z } from "zod";
import {
  DatePicker,
  Hidden,
  NumberControlled,
  Submit
} from "~/components/Form";
import { useCurrencyDecimals, usePermissions } from "~/hooks";
import { contractLineName } from "./contractGrid";
import type { ContractLine } from "./types";

/** The date is the one field typed here; the route validates the edit
 *  (`customerContractScheduleEditValidator` / `…RevenueEditValidator`). */
const amountsFormValidator = z.object({
  date: z.string().min(1, { message: "Date is required" })
});

type ContractAmountsModalProps = {
  /** `addInvoice` posts an invoice date to the schedule route; `addMonth`
   *  posts the first of the chosen month to the revenue route. */
  intent: "addInvoice" | "addMonth";
  action: string;
  title: ReactNode;
  description: ReactNode;
  lines: ContractLine[];
  /** Each line's amount to start from — what it has left to place. */
  defaults: Record<string, number>;
  defaultDate: string;
  currencyCode: string;
  onClose: () => void;
};

/** Add one row to a setup grid: a date, then one amount per line, each
 *  pre-filled with what that line still has to place. */
const ContractAmountsModal = ({
  intent,
  action,
  title,
  description,
  lines,
  defaults,
  defaultDate,
  currencyCode,
  onClose
}: ContractAmountsModalProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const submitted = useRef(false);
  const decimals = useCurrencyDecimals(currencyCode);

  const [date, setDate] = useState(defaultDate);
  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      lines.map((line) => [line.id, Math.max(defaults[line.id] ?? 0, 0)])
    )
  );

  // The action redirects back with a flash; close once it has settled.
  useEffect(() => {
    if (fetcher.state === "idle" && submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  const isMonth = intent === "addMonth";
  const payload = JSON.stringify(
    lines.map((line) => ({
      customerContractLineId: line.id,
      amount: amounts[line.id] ?? 0
    }))
  );

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={amountsFormValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{ date: defaultDate }}
          onSubmit={() => {
            submitted.current = true;
          }}
        >
          <ModalHeader>
            <ModalTitle>{title}</ModalTitle>
            <ModalDescription>{description}</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value={intent} />
            <Hidden
              name={isMonth ? "periodStart" : "invoiceDate"}
              value={isMonth && date ? monthStart(date) : date}
            />
            <Hidden name="amounts" value={payload} />
            <VStack spacing={4}>
              <DatePicker
                name="date"
                label={isMonth ? t`Month` : t`Invoice Date`}
                helperText={
                  isMonth ? t`Any day in the month adds that month` : undefined
                }
                onChange={(value) => setDate(value ?? "")}
              />
              {lines.map((line, index) => (
                <NumberControlled
                  key={line.id}
                  name={`amount${index}`}
                  label={contractLineName(line)}
                  value={amounts[line.id] ?? 0}
                  minValue={0}
                  step={INPUT_STEP.money(decimals)}
                  formatOptions={INPUT_FORMAT.money(currencyCode, decimals)}
                  onChange={(value) =>
                    setAmounts((prev) => ({
                      ...prev,
                      [line.id]: Number.isNaN(value) ? 0 : value
                    }))
                  }
                />
              ))}
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="secondary"
              isDisabled={fetcher.state !== "idle"}
              onClick={onClose}
            >
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              withBlocker={false}
              isDisabled={!date || !permissions.can("update", "sales")}
            >
              <Trans>Add</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default ContractAmountsModal;
