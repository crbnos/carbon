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
  ModalOverlay,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";
import { DateTime } from "~/components";
import { Hidden, Number, Select, Submit, TextArea } from "~/components/Form";
import { usePermissions, useQuantityFormatter } from "~/hooks";
import { path } from "~/utils/path";
import { manualPegValidator } from "../../projects.models";

type ManualPegFormProps = {
  /** The Soft peg the Manual peg replaces. */
  peg: {
    id: string;
    supplyType: string;
    supplyId: string;
    quantity: number;
    needDate: string | null;
    item: { readableIdWithRevision: string | null; name: string } | null;
  };
  /** The open orders of the peg's planning group for the same item. */
  supplies: {
    supplyType: "Purchase Order Line" | "Job";
    supplyId: string;
    readableId: string;
  }[];
  onClose: () => void;
};

/**
 * Overrides one Soft peg with a Manual peg: the planner names the order,
 * the quantity and the reason. MRP keeps a Manual peg on every run.
 */
export default function ManualPegForm({
  peg,
  supplies,
  onClose
}: ManualPegFormProps) {
  const { t } = useLingui();
  const { projectId } = useParams();
  if (!projectId) throw new Error("projectId not found");
  const permissions = usePermissions();
  const formatQuantity = useQuantityFormatter();

  const typeLabel = (type: string) =>
    type === "Job" ? t`Job` : t`Purchase Order`;

  const options = supplies.map((supply) => ({
    label: `${supply.readableId} · ${typeLabel(supply.supplyType)}`,
    value: `${supply.supplyType}:${supply.supplyId}`
  }));
  const current = `${peg.supplyType}:${peg.supplyId}`;

  return (
    <Modal open onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay />
      <ModalContent>
        <ValidatedForm
          validator={manualPegValidator}
          method="post"
          action={`${path.to.projectPeggingManual(projectId)}?pegId=${peg.id}`}
          defaultValues={{
            pegId: peg.id,
            supply: options.some((option) => option.value === current)
              ? current
              : "",
            quantity: peg.quantity,
            manualReason: ""
          }}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Override Peg</Trans>
            </ModalTitle>
            <ModalDescription>
              <Trans>
                A manual peg reserves an order of the planning group for this
                project. MRP keeps it on every run.
              </Trans>
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <Hidden name="pegId" />
              <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                <dt className="text-muted-foreground">
                  <Trans>Item</Trans>
                </dt>
                <dd className="truncate">
                  {peg.item?.readableIdWithRevision ?? ""}{" "}
                  <span className="text-muted-foreground">
                    {peg.item?.name ?? ""}
                  </span>
                </dd>
                <dt className="text-muted-foreground">
                  <Trans>Pegged</Trans>
                </dt>
                <dd className="tabular-nums">{formatQuantity(peg.quantity)}</dd>
                <dt className="text-muted-foreground">
                  <Trans>Need Date</Trans>
                </dt>
                <dd>
                  {peg.needDate ? (
                    <DateTime value={peg.needDate} variant="date" />
                  ) : (
                    ""
                  )}
                </dd>
              </dl>
              {options.length === 0 ? (
                <p className="w-full rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  <Trans>
                    The planning group has no open purchase order or job for
                    this item.
                  </Trans>
                </p>
              ) : (
                <Select name="supply" label={t`Supply`} options={options} />
              )}
              <Number name="quantity" label={t`Quantity`} minValue={0} />
              <TextArea name="manualReason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <Submit
              withBlocker={false}
              isDisabled={
                options.length === 0 || !permissions.can("update", "projects")
              }
            >
              <Trans>Save</Trans>
            </Submit>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}
