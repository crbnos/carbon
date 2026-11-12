// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import { useAction, useLoaderQuery } from "@carbon/query";
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
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { z } from "zod";
import {
  Combobox,
  Employee,
  Item,
  MultiSelect,
  Submit,
  TextArea,
  WorkCenter
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { manualInspectionValidator } from "~/modules/quality/quality.models";
import type {
  getInspectableTrackedEntities,
  getInspectionDocumentsForItem
} from "~/modules/quality/quality.service";
import { path } from "~/utils/path";

type ManualInspectionFormProps = {
  initialValues: z.infer<typeof manualInspectionValidator>;
  open?: boolean;
  onClose: () => void;
};

const ManualInspectionForm = ({
  initialValues,
  open = true,
  onClose
}: ManualInspectionFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  // A refusal (an entity already being inspected, the wrong status) keeps the
  // drawer open with the picks; success links to the new inspection and closes.
  const fetcher = useAction<{
    data: { id: string; inspectionId: string } | null;
  }>({
    onSuccess: ({ data: created }) => {
      if (created) {
        toast.success(
          <span>
            <Trans>
              Created{" "}
              <Link className="underline" to={path.to.inspection(created.id)}>
                {created.inspectionId}
              </Link>
            </Trans>
          </span>
        );
      }
      onClose();
    }
  });
  const [itemId, setItemId] = useState(initialValues.itemId);

  const entities = useLoaderQuery<
    Awaited<ReturnType<typeof getInspectableTrackedEntities>>
  >(itemId ? path.to.api.inspectionTrackedEntities(itemId) : null);

  const entityOptions = useMemo(
    () =>
      (entities.data?.data ?? []).map((entity) => ({
        value: entity.id,
        label: entity.readableId ?? entity.id,
        helper:
          entity.status === "On Hold"
            ? t`On Hold · ${entity.quantity}`
            : String(entity.quantity)
      })),
    [entities.data, t]
  );

  // A lot is inspected against a published plan: the item's Active versions.
  const plans = useLoaderQuery<
    Awaited<ReturnType<typeof getInspectionDocumentsForItem>>
  >(itemId ? path.to.api.inspectionDocuments(itemId) : null);

  const planOptions = useMemo(
    () =>
      (plans.data?.data ?? [])
        .filter((plan) => plan.status === "Active")
        .map((plan) => ({
          value: plan.id,
          label: `${plan.name ?? plan.fileName ?? plan.id} v${plan.version}`
        })),
    [plans.data]
  );

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={manualInspectionValidator}
            method="post"
            action={path.to.newInspection}
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>{t`New Inspection`}</ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <VStack spacing={4}>
                <Item
                  name="itemId"
                  label={t`Item`}
                  type="Item"
                  onChange={(value) => setItemId(value?.value ?? "")}
                />
                <MultiSelect
                  // Remount with the item so a previous item's picks are cleared.
                  key={itemId}
                  name="trackedEntityIds"
                  label={t`Tracked Entities`}
                  options={entityOptions}
                  isReadOnly={!itemId}
                  helperText={t`Available or On Hold serials and batches. Available ones go On Hold until the inspection is dispositioned.`}
                />
                <Combobox
                  key={`plan-${itemId}`}
                  name="inspectionDocumentId"
                  label={t`Inspection Plan`}
                  options={planOptions}
                  isLoading={plans.isFetching}
                  isReadOnly={!itemId}
                />
                <WorkCenter
                  name="workCenterId"
                  label={t`Work Center`}
                  isOptional
                />
                <Employee name="assignee" label={t`Assignee`} isOptional />
                <TextArea name="notes" label={t`Notes`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={!permissions.can("create", "quality")}>
                  {t`Create`}
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  {t`Cancel`}
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default ManualInspectionForm;
