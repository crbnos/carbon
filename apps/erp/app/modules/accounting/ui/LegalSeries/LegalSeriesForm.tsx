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
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Boolean,
  CustomFormFields,
  DatePicker,
  Hidden,
  Input,
  Number,
  Select,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  legalSeriesDocumentTypes,
  legalSeriesValidator
} from "../../accounting.models";

type LegalSeriesFormProps = {
  initialValues: z.infer<typeof legalSeriesValidator>;
  formatLocked?: boolean;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const documentTypeLabels: Record<
  (typeof legalSeriesDocumentTypes)[number],
  string
> = {
  salesInvoice: "Sales Invoice",
  creditMemo: "Credit Memo"
};

const LegalSeriesForm = ({
  initialValues,
  formatLocked = false,
  open = true,
  type = "drawer",
  onClose
}: LegalSeriesFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  const isEditing = initialValues.id !== undefined;
  const isDisabled = isEditing
    ? !permissions.can("update", "accounting")
    : !permissions.can("create", "accounting");

  const documentTypeOptions = legalSeriesDocumentTypes.map((v) => ({
    label: documentTypeLabels[v],
    value: v
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
            validator={legalSeriesValidator}
            method="post"
            action={
              isEditing
                ? path.to.legalSeriesById(initialValues.id!)
                : path.to.newLegalSeries
            }
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? (
                  <Trans>Edit Legal Series</Trans>
                ) : (
                  <Trans>New Legal Series</Trans>
                )}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="type" value={type} />
              <VStack spacing={4}>
                <Input
                  name="countryCode"
                  label={t`Country Code`}
                  isDisabled={formatLocked}
                  helperText={
                    formatLocked ? t`Locked after first use` : undefined
                  }
                />
                <Select
                  name="documentType"
                  label={t`Document Type`}
                  options={documentTypeOptions}
                  isReadOnly={formatLocked}
                  helperText={
                    formatLocked ? t`Locked after first use` : undefined
                  }
                />
                <Input
                  name="code"
                  label={t`Code`}
                  isDisabled={formatLocked}
                  helperText={
                    formatLocked ? t`Locked after first use` : undefined
                  }
                />
                <Input name="name" label={t`Name`} />
                <Input
                  name="prefix"
                  label={t`Prefix`}
                  isDisabled={formatLocked}
                  helperText={
                    formatLocked ? t`Locked after first use` : undefined
                  }
                />
                <Number
                  name="size"
                  label={t`Size`}
                  minValue={1}
                  isDisabled={formatLocked}
                  helperText={
                    formatLocked ? t`Locked after first use` : undefined
                  }
                />
                <DatePicker name="validFrom" label={t`Valid From`} />
                <DatePicker name="validTo" label={t`Valid To`} />
                <Input name="registrationRef" label={t`Registration Ref`} />
                <Boolean name="isDefault" label={t`Default`} />
                <Boolean name="isActive" label={t`Active`} />
                <CustomFormFields table="legalSeries" />
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

export default LegalSeriesForm;
