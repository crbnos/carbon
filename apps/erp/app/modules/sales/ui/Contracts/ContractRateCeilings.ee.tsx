// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import {
  contractRateCeilingValidator,
  type IndirectBaseType
} from "@carbon/ee/indirect-rates";
import { ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { INPUT_FORMAT, INPUT_STEP } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPercent, LuPlus, LuTrash } from "react-icons/lu";
import {
  Hidden,
  Number as NumberField,
  SelectControlled,
  Submit
} from "~/components/Form";
import { ConfirmDelete } from "~/components/Modals";
import { UpgradeOverlaySection } from "~/components/UpgradeOverlay";
import {
  useCurrencyDecimals,
  useCurrencyFormatter,
  usePercentFormatter,
  useUser
} from "~/hooks";
import { usePlanGate } from "~/hooks/usePlanGate";

export type ContractRateCeiling = {
  id: string;
  indirectPoolId: string;
  ceilingRate: number;
  indirectPool: { name: string; sequence: number } | null;
};

export type CeilingPool = {
  id: string;
  name: string;
  baseType: IndirectBaseType;
};

type ContractRateCeilingsProps = {
  lineId: string;
  ceilings: ContractRateCeiling[];
  /** The active pools that apply to projects: the choices for a ceiling. */
  pools: CeilingPool[];
  /** The labor-rates action route of the line. */
  action: string;
  isDisabled: boolean;
};

/**
 * The indirect rate ceilings of a Cost Plus line. Burden bills at the lower
 * of the billing rate and the line's ceiling for the pool. A company without
 * government contracting sees the section behind the upgrade overlay.
 */
export default function ContractRateCeilings(props: ContractRateCeilingsProps) {
  const { isGated } = usePlanGate({ feature: "GOVERNMENT_CONTRACTING" });

  if (isGated) {
    return (
      <UpgradeOverlaySection
        icon={<LuPercent className="size-6 text-muted-foreground" />}
        title={<Trans>Rate Ceilings</Trans>}
        description={
          <Trans>
            Cap the indirect rates a Cost Plus line bills, and bill burden at
            provisional rates.
          </Trans>
        }
      >
        <RateCeilingsCard {...props} ceilings={[]} isDisabled />
      </UpgradeOverlaySection>
    );
  }

  return <RateCeilingsCard {...props} />;
}

function RateCeilingsCard({
  lineId,
  ceilings,
  pools,
  action,
  isDisabled
}: ContractRateCeilingsProps) {
  const { t } = useLingui();
  const percent = usePercentFormatter();
  const perHour = useCurrencyFormatter({ rate: true });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ContractRateCeiling | null>(null);

  const baseTypeOf = new Map(pools.map((pool) => [pool.id, pool.baseType]));
  const ceilingPoolIds = new Set(ceilings.map((c) => c.indirectPoolId));
  const availablePools = pools.filter((pool) => !ceilingPoolIds.has(pool.id));
  const sorted = [...ceilings].sort(
    (a, b) => (a.indirectPool?.sequence ?? 0) - (b.indirectPool?.sequence ?? 0)
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Rate Ceilings</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Burden bills at the lower of the billing rate and the ceiling.
              With no ceiling, a pool bills at its billing rate.
            </Trans>
          </CardDescription>
          <CardAction>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={isDisabled || availablePools.length === 0}
              onClick={() => setAdding(true)}
            >
              <Trans>Add Ceiling</Trans>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No ceilings. Burden bills at the billing rates.</Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-full">
                    <Trans>Pool</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Ceiling</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {sorted.map((ceiling) => (
                  <Tr key={ceiling.id}>
                    <Td>
                      <span className="truncate">
                        {ceiling.indirectPool?.name ?? ceiling.indirectPoolId}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      {baseTypeOf.get(ceiling.indirectPoolId) ===
                      "Direct Labor Hours"
                        ? t`${perHour.format(ceiling.ceilingRate)}/h`
                        : percent.format(ceiling.ceilingRate)}
                    </Td>
                    <Td>
                      <IconButton
                        aria-label={t`Delete ceiling`}
                        icon={<LuTrash />}
                        variant="ghost"
                        size="sm"
                        isDisabled={isDisabled}
                        onClick={() => setDeleting(ceiling)}
                      />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {adding && (
        <RateCeilingModal
          lineId={lineId}
          pools={availablePools}
          action={action}
          onClose={() => setAdding(false)}
        />
      )}
      {deleting && (
        <ConfirmDelete
          action={action}
          isOpen
          name={deleting.indirectPool?.name ?? t`Ceiling`}
          text={t`Are you sure you want to delete this rate ceiling?`}
          fields={{ intent: "ceiling-delete", id: deleting.id }}
          onCancel={() => setDeleting(null)}
          onSubmit={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function RateCeilingModal({
  lineId,
  pools,
  action,
  onClose
}: {
  lineId: string;
  pools: CeilingPool[];
  action: string;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { company } = useUser();
  const currency = company?.baseCurrencyCode ?? "USD";
  const decimals = useCurrencyDecimals(currency);
  const [poolId, setPoolId] = useState<string>(pools[0]?.id ?? "");
  const perHour =
    pools.find((pool) => pool.id === poolId)?.baseType === "Direct Labor Hours";
  const fetcher = useAction<{ error?: { message: string } | null }>({
    onSuccess: () => onClose(),
    onError: (data) =>
      toast.error(data?.error?.message ?? t`Failed to save the ceiling`)
  });

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalContent>
        <ValidatedForm
          validator={contractRateCeilingValidator}
          method="post"
          action={action}
          fetcher={fetcher}
          defaultValues={{
            customerContractLineId: lineId,
            indirectPoolId: poolId,
            ceilingRate: 0
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Add Ceiling</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>The highest rate this line bills for the pool.</Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Hidden name="intent" value="ceiling-upsert" />
            <Hidden name="customerContractLineId" />
            <VStack spacing={4}>
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
              {perHour ? (
                <NumberField
                  key="per-hour"
                  name="ceilingRate"
                  label={t`Ceiling per Hour`}
                  minValue={0}
                  step={INPUT_STEP.rate}
                  formatOptions={INPUT_FORMAT.rate(currency, decimals)}
                />
              ) : (
                <NumberField
                  key="percent"
                  name="ceilingRate"
                  label={t`Ceiling`}
                  minValue={0}
                  step={INPUT_STEP.percent}
                  formatOptions={INPUT_FORMAT.percent}
                />
              )}
            </VStack>
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
}
