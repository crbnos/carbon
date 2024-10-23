import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  VStack,
} from "@carbon/react";

import { useNavigate } from "@remix-run/react";
import type { z } from "zod";
import {
  Employee,
  Hidden,
  Number,
  Select,
  Submit,
  TextArea,
} from "~/components/Form";
import ScrapReason from "~/components/Form/ScrapReason";
import { usePermissions } from "~/hooks";
import { productionQuantityValidator } from "~/modules/production";

type ProductionQuantityFormProps = {
  initialValues: z.infer<typeof productionQuantityValidator>;
};

const ProductionQuantityForm = ({
  initialValues,
}: ProductionQuantityFormProps) => {
  const permissions = usePermissions();
  const navigate = useNavigate();
  const onClose = () => navigate(-1);

  const isDisabled = !permissions.can("update", "production");
  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent>
        <ValidatedForm
          validator={productionQuantityValidator}
          method="post"
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>Edit Production Quantity</DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <Hidden name="id" />
            <Hidden name="jobOperationId" />
            <VStack spacing={4}>
              <Employee name="createdBy" label="Employee" />
              <Number name="quantity" label="Quantity" />
              <Select
                name="type"
                label="Quantity Type"
                options={[
                  { label: "Production", value: "Production" },
                  { label: "Scrap", value: "Scrap" },
                  { label: "Rework", value: "Rework" },
                ]}
              />
              <ScrapReason name="scrapReasonId" label="Scrap Reason" />
              <TextArea name="notes" label="Notes" />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <HStack>
              <Submit isDisabled={isDisabled}>Save</Submit>
              <Button variant="solid" onClick={onClose}>
                Cancel
              </Button>
            </HStack>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
};

export default ProductionQuantityForm;
