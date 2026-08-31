import { useControlField, ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import {
  CustomFormFields,
  Hidden,
  Input,
  Item,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  repairBillingCodeType,
  repairOrderChargeTypeType,
  repairOrderChargeValidator
} from "../../sales.models";
import type { RepairOrderLine } from "./types";

type RepairChargeFormProps = {
  repairOrderId: string;
  lines: RepairOrderLine[];
  onClose: () => void;
};

/**
 * Re-derives the billing code when the unit or the charge type changes. Lives
 * INSIDE the form because `defaultValues` only applies on mount, and the two
 * inputs that decide coverage are both editable after it. The first run is
 * skipped so the mount-time default stands; a later manual override survives
 * until one of those two inputs actually moves the verdict.
 */
function BillingCodeDefault({ covered }: { covered: boolean }) {
  const [, setBillingCode] = useControlField<string>("billingCode");
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    setBillingCode(covered ? "Warranty" : "Billable");
  }, [covered, setBillingCode]);

  return null;
}

const RepairChargeForm = ({
  repairOrderId,
  lines,
  onClose
}: RepairChargeFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  // Default the billing code from the unit's coverage, exactly as the spec
  // requires — the user can still override it in either direction until the
  // charge is issued.
  const [lineId, setLineId] = useState<string>(lines[0]?.id ?? "");
  const [chargeType, setChargeType] = useState<"Part" | "Service">("Part");
  const selectedLine = lines.find((line) => line.id === lineId);

  // Coverage is split by class, so the default follows the CHARGE TYPE: a Part
  // bills against parts coverage, a Service against labor. `underWarranty` is
  // only "a registration was attached at intake" — reading the default off it
  // sent expired work to Warranty Expense, which the spec calls out by name.
  const covered =
    chargeType === "Service"
      ? (selectedLine?.laborInWarranty ?? false)
      : (selectedLine?.partsInWarranty ?? false);
  const defaultBillingCode = covered ? "Warranty" : "Billable";

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={repairOrderChargeValidator}
            method="post"
            action={path.to.repairOrderNewCharge(repairOrderId)}
            defaultValues={{
              repairOrderId,
              repairOrderLineId: lineId,
              chargeType: "Part" as const,
              quantity: 1,
              unitPrice: 0,
              billingCode: defaultBillingCode as "Warranty" | "Billable"
            }}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                <Trans>Add Charge</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="repairOrderId" />
              <BillingCodeDefault covered={covered} />
              <VStack spacing={4}>
                <Select
                  name="repairOrderLineId"
                  label={t`Unit`}
                  options={lines.map((line) => ({
                    label: `${line.lineNumber} — ${
                      line.item?.readableIdWithRevision ?? line.itemId
                    }`,
                    value: line.id
                  }))}
                  onChange={(option) => setLineId(option?.value ?? "")}
                />
                <Select
                  name="chargeType"
                  label={t`Type`}
                  options={repairOrderChargeTypeType.map((type) => ({
                    label: type,
                    value: type
                  }))}
                  onChange={(option) =>
                    setChargeType(
                      (option?.value as "Part" | "Service") ?? "Part"
                    )
                  }
                  helperText={t`A Part consumes shop stock; a Service records labor or a fee`}
                />
                <Item name="itemId" label={t`Item`} type="Item" />
                <Input name="description" label={t`Description`} />
                <Number name="quantity" label={t`Quantity`} minValue={0} />
                <Number name="unitPrice" label={t`Unit Price`} minValue={0} />
                <Select
                  name="billingCode"
                  label={t`Billing`}
                  options={repairBillingCodeType.map((code) => ({
                    label: code,
                    value: code
                  }))}
                  helperText={t`Defaulted from the unit's warranty coverage`}
                />
                <CustomFormFields table="repairOrderCharge" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("update", "sales")}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default RepairChargeForm;
