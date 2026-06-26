import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { z } from "zod";
import {
  CustomFormFields,
  Number,
  Submit,
  Supplier,
  SupplierContact
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import { contractorValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type ContractorFormProps = {
  initialValues: z.infer<typeof contractorValidator>;
};

const ContractorForm = ({ initialValues }: ContractorFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const onClose = () => navigate(-1);

  const [supplier, setSupplier] = useState<string | null>(
    initialValues?.supplierId ?? null
  );

  const isEditing = !location.pathname.includes("new");
  const isDisabled = isEditing
    ? !permissions.can("update", "resources")
    : !permissions.can("create", "resources");

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={contractorValidator}
          method="post"
          action={
            isEditing
              ? path.to.contractor(initialValues.id!)
              : path.to.newContractor
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing ? (
                <Trans>Edit Contractor</Trans>
              ) : (
                <Trans>New Contractor</Trans>
              )}
            </DrawerTitle>
            <DrawerDescription>
              <Trans>
                A contractor is a supplier contact with particular abilities and
                available hours
              </Trans>
            </DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              <Supplier
                name="supplierId"
                label={t`Supplier`}
                isReadOnly={isEditing}
                onChange={(value) => setSupplier(value?.value as string)}
              />
              <SupplierContact
                name="id"
                supplier={supplier ?? undefined}
                isReadOnly={isEditing}
              />
              {/* <Abilities name="abilities" label="Abilities" /> */}
              <Number
                name="hoursPerWeek"
                label={t`Hours per Week`}
                termId="contractor-hours-per-week"
                helperText={t`The number of hours per week the contractor is available to work.`}
                minValue={0}
                maxValue={10000}
              />
              <CustomFormFields table="contractor" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>
                <Trans>Save</Trans>
              </Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ContractorForm;
