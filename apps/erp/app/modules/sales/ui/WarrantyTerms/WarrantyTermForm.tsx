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
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  Hidden,
  Input,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  warrantyTermStartBasisType,
  warrantyTermValidator
} from "../../sales.models";

type WarrantyTermFormProps = {
  initialValues: z.infer<typeof warrantyTermValidator>;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const WarrantyTermForm = ({
  initialValues,
  open = true,
  type = "drawer",
  onClose
}: WarrantyTermFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created warranty term`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create warranty term: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  const startBasisOptions = warrantyTermStartBasisType.map((basis) => ({
    label: basis,
    value: basis
  }));

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
            validator={warrantyTermValidator}
            method="post"
            action={
              isEditing
                ? path.to.warrantyTerm(initialValues.id!)
                : path.to.newWarrantyTerm
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? <Trans>Edit</Trans> : <Trans>New</Trans>}{" "}
                <Trans>Warranty Term</Trans>
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input name="name" label={t`Name`} />
                <Select
                  name="startBasis"
                  label={t`Warranty starts on`}
                  options={startBasisOptions}
                  helperText={t`Which document starts the clock`}
                />
                <Boolean name="coversParts" label={t`Covers parts`} />
                <Number
                  name="partsDurationMonths"
                  label={t`Parts duration (months)`}
                  helperText={t`Leave empty for lifetime coverage`}
                  minValue={0}
                />
                <Boolean name="coversLabor" label={t`Covers labor`} />
                <Number
                  name="laborDurationMonths"
                  label={t`Labor duration (months)`}
                  helperText={t`Leave empty for lifetime coverage`}
                  minValue={0}
                />
                <CustomFormFields table="warrantyTerm" />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Submit isDisabled={isDisabled}>
                  <Trans>Save</Trans>
                </Submit>
                <Button size="md" variant="solid" onClick={() => onClose()}>
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

export default WarrantyTermForm;
