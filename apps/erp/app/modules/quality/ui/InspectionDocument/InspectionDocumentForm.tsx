import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import { Hidden, Input, Item, Submit } from "~/components/Form";
import { inspectionDocumentValidator } from "~/modules/quality/quality.models";
import { path } from "~/utils/path";

type InspectionDocumentFormProps = {
  initialValues: {
    id?: string;
    name: string;
    partId: string;
    drawingNumber?: string;
  };
  onClose: () => void;
};

export default function InspectionDocumentForm({
  initialValues,
  onClose
}: InspectionDocumentFormProps) {
  const { t } = useLingui();
  const isEditing = Boolean(initialValues.id);

  return (
    <Drawer open onOpenChange={(open) => !open && onClose()}>
      <DrawerContent>
        <ValidatedForm
          validator={inspectionDocumentValidator}
          method="post"
          action={
            isEditing
              ? path.to.inspectionDocument(initialValues.id!)
              : path.to.newInspectionDocument
          }
          defaultValues={initialValues}
          className="flex flex-col h-full"
        >
          <DrawerHeader>
            <DrawerTitle>
              {isEditing
                ? t`Edit Inspection Document`
                : t`New Inspection Document`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              {isEditing && <Hidden name="id" />}
              <Item name="partId" type="Part" />
              <Input
                name="drawingNumber"
                label={t`Drawing Number`}
                placeholder={t`e.g. DWG-1234`}
              />
            </VStack>
          </DrawerBody>
          <DrawerFooter>
            <Button variant="ghost" onClick={onClose}>
              {t`Cancel`}
            </Button>
            <Submit>{isEditing ? t`Save` : t`Create`}</Submit>
          </DrawerFooter>
        </ValidatedForm>
      </DrawerContent>
    </Drawer>
  );
}
