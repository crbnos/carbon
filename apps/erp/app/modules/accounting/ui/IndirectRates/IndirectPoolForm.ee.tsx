// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { IndirectPoolType } from "@carbon/ee/indirect-rates";
import {
  indirectBaseTypes,
  indirectPoolTypes,
  indirectPoolValidator
} from "@carbon/ee/indirect-rates";
import { ValidatedForm } from "@carbon/form";
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
import type { ReactNode } from "react";
import { useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Account,
  Boolean,
  Hidden,
  Input,
  Number as NumberField,
  Select,
  SelectControlled,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

const FORM_ID = "indirect-pool-form";

type IndirectPoolFormProps = {
  initialValues: z.infer<typeof indirectPoolValidator>;
  /** An existing pool only: its account mappings, below the form. */
  children?: ReactNode;
  onClose: () => void;
};

/**
 * Creates or edits an indirect pool in a drawer. An existing pool lists its
 * account mappings below the form; they save on their own.
 */
const IndirectPoolForm = ({
  initialValues,
  children,
  onClose
}: IndirectPoolFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const [poolType, setPoolType] = useState<IndirectPoolType>(
    initialValues.poolType
  );

  const isEditing = initialValues.id !== undefined;
  const canSave = isEditing
    ? permissions.can("update", "accounting")
    : permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <div className="flex h-full flex-col">
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? <Trans>Edit Pool</Trans> : <Trans>New Pool</Trans>}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <ValidatedForm
                id={FORM_ID}
                validator={indirectPoolValidator}
                method="post"
                action={
                  isEditing
                    ? path.to.indirectPool(initialValues.id!)
                    : path.to.newIndirectPool
                }
                defaultValues={initialValues}
                fetcher={fetcher}
                className="w-full"
              >
                <Hidden name="id" />
                <VStack spacing={4}>
                  <Input name="name" label={t`Name`} autoFocus={!isEditing} />
                  <SelectControlled
                    name="poolType"
                    label={t`Pool Type`}
                    options={indirectPoolTypes.map((type) => ({
                      label: type,
                      value: type
                    }))}
                    value={poolType}
                    onChange={(option) =>
                      setPoolType(
                        (option?.value as IndirectPoolType) ?? "Overhead"
                      )
                    }
                  />
                  <NumberField
                    name="sequence"
                    label={t`Sequence`}
                    minValue={1}
                    helperText={t`Pools compute in this order. A later pool takes the burden of an earlier one.`}
                  />
                  <Select
                    name="baseType"
                    label={t`Base`}
                    options={indirectBaseTypes.map((type) => ({
                      label: type,
                      value: type
                    }))}
                  />
                  <Account
                    name="appliedAccountId"
                    label={t`Applied Account`}
                    isOptional
                    helperText={t`Credited when burden posts as applied burden`}
                  />
                  {poolType !== "Service Center" && (
                    <Boolean
                      name="appliesToProjects"
                      label={t`Applies to Projects`}
                      description={t`The burden run burdens project cost with this pool`}
                    />
                  )}
                  {poolType === "Overhead" && (
                    <Boolean
                      name="offsetAbsorbedOverhead"
                      label={t`Offset Absorbed Overhead`}
                      description={t`Subtract the overhead work centers already applied from each project's burden`}
                    />
                  )}
                  <Boolean
                    name="active"
                    label={t`Active`}
                    description={t`An inactive pool computes no rate and burdens nothing`}
                  />
                </VStack>
              </ValidatedForm>
              {children}
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit formId={FORM_ID} isDisabled={!canSave}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
              </HStack>
            </ModalDrawerFooter>
          </div>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default IndirectPoolForm;
