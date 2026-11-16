// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Result } from "@carbon/auth";
import { Hidden, Select, Submit, TextArea, ValidatedForm } from "@carbon/form";
import { useAction } from "@carbon/query";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { materialRequestValidator } from "~/services/models";
import { path } from "~/utils/path";

export function NeedMaterialModal({
  operationId,
  materials,
  isOpen,
  onClose
}: {
  operationId: string;
  materials: { itemId: string; label: string }[];
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <NeedMaterialBody
          operationId={operationId}
          materials={materials}
          onClose={onClose}
        />
      </ModalContent>
    </Modal>
  );
}

function NeedMaterialBody({
  operationId,
  materials,
  onClose
}: {
  operationId: string;
  materials: { itemId: string; label: string }[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useAction<Result>({
    onSuccess: (data) => {
      if (data?.success) {
        toast.success(t`Material requested`);
        onClose();
      }
    }
  });

  // One option per part: an operation can list the same part on more than
  // one material line.
  const options = Array.from(
    new Map(materials.map((m) => [m.itemId, m.label])).entries()
  ).map(([value, label]) => ({ value, label }));

  return (
    <ValidatedForm
      method="post"
      action={path.to.materialRequestNew}
      validator={materialRequestValidator}
      defaultValues={{
        jobOperationId: operationId,
        itemId: "",
        note: ""
      }}
      fetcher={fetcher}
    >
      <ModalHeader>
        <ModalTitle>
          <Trans>Need material</Trans>
        </ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Hidden name="jobOperationId" value={operationId} />
        <VStack spacing={4}>
          {options.length > 0 && (
            <Select
              name="itemId"
              label={t`Part`}
              placeholder={t`Any part`}
              size="lg"
              isClearable
              options={options}
            />
          )}
          <TextArea
            name="note"
            label={t`Note`}
            placeholder={t`What do you need?`}
            size="lg"
          />
        </VStack>
      </ModalBody>
      <ModalFooter>
        <HStack>
          <Button variant="secondary" size="lg" onClick={onClose}>
            <Trans>Cancel</Trans>
          </Button>
          <Submit size="lg" isLoading={fetcher.state !== "idle"}>
            <Trans>Request material</Trans>
          </Submit>
        </HStack>
      </ModalFooter>
    </ValidatedForm>
  );
}
