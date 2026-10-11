// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IndirectPool } from "@carbon/ee/indirect-rates";
import {
  enteredIndirectRateTypes,
  indirectRateEntryValidator
} from "@carbon/ee/indirect-rates";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  Hidden,
  Number as NumberField,
  Select,
  SelectControlled,
  Submit
} from "~/components/Form";
import { useCurrencyDecimals, useUser } from "~/hooks";

type SetIndirectRateModalProps = {
  pools: IndirectPool[];
  fiscalYear: number;
  action: string;
  onClose: () => void;
};

/**
 * Sets a Provisional, Target or Final rate from a period to the end of the
 * year (B12). Actual rates come from the period run only.
 */
const SetIndirectRateModal = ({
  pools,
  fiscalYear,
  action,
  onClose
}: SetIndirectRateModalProps) => {
  const { t } = useLingui();
  const fetcher = useAction({ onSuccess: onClose });
  const [poolId, setPoolId] = useState<string>(pools[0]?.id ?? "");
  const { company } = useUser();
  const currency = company?.baseCurrencyCode ?? "USD";
  const decimalPlaces = useCurrencyDecimals(currency);

  // An hours-base pool's rate is an amount per hour, not a fraction.
  const perHour =
    pools.find((pool) => pool.id === poolId)?.baseType === "Direct Labor Hours";

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={indirectRateEntryValidator}
          method="post"
          action={action}
          defaultValues={{
            indirectPoolId: poolId,
            rateType: "Provisional",
            fiscalYear,
            fromPeriod: 1,
            rate: 0
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Set Rate, FY{fiscalYear}</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="set-rate" />
            <Hidden name="fiscalYear" />
            <div className="flex flex-col gap-4">
              <SelectControlled
                name="indirectPoolId"
                label={t`Pool`}
                options={pools.map((pool) => ({
                  label: pool.name,
                  value: pool.id
                }))}
                value={poolId}
                onChange={(option) => setPoolId(option?.value ?? "")}
              />
              <Select
                name="rateType"
                label={t`Rate Type`}
                options={enteredIndirectRateTypes.map((rateType) => ({
                  label: rateType,
                  value: rateType
                }))}
              />
              <NumberField
                name="fromPeriod"
                label={t`From Period`}
                minValue={1}
                maxValue={12}
                helperText={t`The rate applies from this period to the end of the year`}
              />
              {perHour ? (
                <NumberField
                  key="per-hour"
                  name="rate"
                  label={t`Rate per Hour`}
                  minValue={0}
                  step={INPUT_STEP.rate}
                  formatOptions={INPUT_FORMAT.rate(currency, decimalPlaces)}
                />
              ) : (
                <NumberField
                  key="percent"
                  name="rate"
                  label={t`Rate`}
                  minValue={0}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percent}
                />
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit>
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default SetIndirectRateModal;
