// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TermId } from "@carbon/content/glossary";
import { useAction } from "@carbon/query";
import {
  Button,
  Calendar,
  DatePicker as DatePickerBase,
  FormControl,
  FormLabel,
  IconButton,
  LabelWithHelp,
  Popover,
  PopoverContent,
  PopoverFooter,
  PopoverTrigger,
  toast
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { parseDate, toCalendarDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useRef, useState } from "react";
import { LuCalendarClock } from "react-icons/lu";
import { usePermissions } from "~/hooks";
import {
  type PurchaseOrderLineDateField,
  purchaseOrderLineDateRefusal
} from "~/modules/purchasing/purchasing.models";
import type { action } from "~/routes/x+/purchase-order+/$orderId.$lineId.date";
import { path } from "~/utils/path";
import type { PurchaseOrder } from "../../types";

type LineDates = {
  id: string;
  purchaseOrderId: string;
  receivedComplete: boolean;
} & Record<PurchaseOrderLineDateField, string | null>;

type OrderStatus = Pick<PurchaseOrder, "status">;

/**
 * Saves one line date. A refused save is toasted and bumps that field's
 * `failures`, which its control keys on to show the saved date again.
 */
export function useSavePurchaseOrderLineDate(line: {
  id: string;
  purchaseOrderId: string;
}) {
  const [refused, setRefused] = useState<
    Partial<Record<PurchaseOrderLineDateField, number>>
  >({});
  const saving = useRef<PurchaseOrderLineDateField | null>(null);
  const fetcher = useAction<typeof action>({
    onError: (data) => {
      if (data?.error) toast.error(data.error.message);
      const field = saving.current;
      if (field) {
        setRefused((counts) => ({
          ...counts,
          [field]: (counts[field] ?? 0) + 1
        }));
      }
    }
  });

  const save = (field: PurchaseOrderLineDateField, value: string | null) => {
    saving.current = field;
    const formData = new FormData();
    formData.append("field", field);
    formData.append("value", value ?? "");
    fetcher.submit(formData, {
      method: "post",
      action: path.to.purchaseOrderLineDate(line.purchaseOrderId, line.id)
    });
  };

  const failures = (field: PurchaseOrderLineDateField) => refused[field] ?? 0;

  return { save, failures };
}

export function PurchaseOrderLinePromisedDate({
  line,
  order
}: {
  line: Pick<LineDates, "id" | "purchaseOrderId" | "receivedComplete"> & {
    promisedDate: string | null;
  };
  order: OrderStatus | undefined;
}) {
  const permissions = usePermissions();
  const { save, failures } = useSavePurchaseOrderLineDate(line);
  const value = line.promisedDate;
  const isDisabled =
    !permissions.can("update", "purchasing") ||
    purchaseOrderLineDateRefusal("promisedDate", {
      status: order?.status ?? null,
      receivedComplete: line.receivedComplete
    }) !== null;

  return (
    // The summary row toggles open on click; picking a date must not. The
    // pill's 1px shadow ring sits outside it, so pad it in from the edge.
    <div
      className="flex shrink-0 items-center gap-2 pr-px text-sm whitespace-nowrap"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-muted-foreground whitespace-nowrap">
        <Trans>Promised</Trans>
      </span>
      <DatePill
        key={`${value ?? ""}:${failures("promisedDate")}`}
        value={value}
        isDisabled={isDisabled}
        onChange={(date) => {
          if (date === value) return;
          save("promisedDate", date);
        }}
      />
    </div>
  );
}

function DatePill({
  value,
  isDisabled,
  onChange
}: {
  value: string | null;
  isDisabled: boolean;
  onChange: (date: string | null) => void;
}) {
  const { t } = useLingui();
  const { locale } = useLocale();
  // What was picked, shown until the saved date comes back with the page.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const shown = picked === undefined ? value : picked;

  const [open, setOpen] = useState(false);

  const pick = (next: string | null) => {
    setOpen(false);
    setPicked(next);
    onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {shown ? (
          <Button
            variant="secondary"
            size="sm"
            isDisabled={isDisabled}
            rightIcon={<LuCalendarClock />}
            aria-label={t`Promised Date`}
          >
            <span className="tabular-nums">
              {formatDate(shown, undefined, locale)}
            </span>
          </Button>
        ) : (
          <IconButton
            variant="secondary"
            size="sm"
            isDisabled={isDisabled}
            icon={<LuCalendarClock />}
            aria-label={t`Promised Date`}
          />
        )}
      </PopoverTrigger>
      <PopoverContent align="end">
        <Calendar
          value={shown ? parseDate(shown) : null}
          onChange={(date) => pick(toCalendarDate(date).toString())}
        />
        <PopoverFooter>
          <Button variant="secondary" onClick={() => pick(null)}>
            <Trans>Clear</Trans>
          </Button>
        </PopoverFooter>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A saved line's dates. Each saves when picked, outside the form's submit,
 * because the promised date stays editable after the line is locked.
 */
export function PurchaseOrderLineDateFields({
  line,
  order
}: {
  line: LineDates;
  order: OrderStatus | undefined;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "purchasing");
  const { save, failures } = useSavePurchaseOrderLineDate(line);
  const fields: {
    field: PurchaseOrderLineDateField;
    label: string;
    termId?: TermId;
  }[] = [
    {
      field: "requiredDate",
      label: t`Requested Date`,
      termId: "purchase-order-line-required-date"
    },
    { field: "promisedDate", label: t`Promised Date` },
    { field: "receivedDate", label: t`Delivery Date` }
  ];

  return (
    <>
      {fields.map(({ field, label, termId }) => {
        const value = line[field];
        const refusal = purchaseOrderLineDateRefusal(field, {
          status: order?.status ?? null,
          receivedComplete: line.receivedComplete
        });
        return (
          <LineDateField
            key={`${field}:${value ?? ""}:${failures(field)}`}
            label={label}
            termId={termId}
            value={value}
            isDisabled={!canUpdate || refusal !== null}
            onChange={(date) => save(field, date)}
          />
        );
      })}
    </>
  );
}

/**
 * Not a form field, so the line form's submit and lock skip it. A typed date
 * saves when the field loses focus, not on each keystroke: the picker reports
 * a complete date while the year is still being typed.
 */
function LineDateField({
  label,
  termId,
  value,
  isDisabled,
  onChange
}: {
  label: string;
  termId?: TermId;
  value: string | null;
  isDisabled: boolean;
  onChange: (date: string | null) => void;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  const commit = () => {
    if (draft === committed.current) return;
    committed.current = draft;
    onChange(draft);
  };

  return (
    <FormControl>
      <FormLabel isOptional>
        <LabelWithHelp termId={termId}>{label}</LabelWithHelp>
      </FormLabel>
      <DatePickerBase
        aria-label={label}
        value={draft ? parseDate(draft) : null}
        isDisabled={isDisabled}
        onChange={(date) => setDraft(date ? date.toString() : null)}
        onBlur={commit}
        onOpenChange={(isOpen) => {
          if (!isOpen) commit();
        }}
      />
    </FormControl>
  );
}
