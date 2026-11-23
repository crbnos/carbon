// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
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
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Hidden,
  Input,
  Submit,
  Supplier
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { taxAuthorityValidator } from "../../accounting.models";

type TaxAuthorityFormProps = {
  initialValues: z.infer<typeof taxAuthorityValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: (data?: { id: string; name: string }) => void;
  /** Called with the new authority's id once the modal form has created it. */
  onCreated?: (id: string) => void;
};

const TaxAuthorityForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose,
  onCreated
}: TaxAuthorityFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestSingleResponse<{ id: string }>>();

  // A submission's result is handled once, whatever re-renders follow it.
  const handled = useRef<unknown>(null);
  useEffect(() => {
    if (type !== "modal" || !fetcher.data || handled.current === fetcher.data)
      return;

    if (fetcher.state === "loading" && fetcher.data.data) {
      handled.current = fetcher.data;
      onCreated?.(fetcher.data.data.id);
      onClose?.();
      toast.success(t`Created tax authority`);
    } else if (fetcher.state === "idle" && fetcher.data.error) {
      handled.current = fetcher.data;
      toast.error(
        t`Failed to create tax authority: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, onCreated, type, t]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={taxAuthorityValidator}
            method="post"
            action={
              isEditing
                ? path.to.taxAuthority(initialValues.id!)
                : path.to.newTaxAuthority
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Tax Authority</Trans>
                ) : (
                  <Trans>New Tax Authority</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Supplier
                  name="supplierId"
                  label={t`Supplier`}
                  helperText={t`The supplier you pay this authority's tax to`}
                />
                <CustomFormFields table="taxAuthority" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
              </HStack>
            </ModalDrawerFooter>
          </ValidatedForm>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default TaxAuthorityForm;
