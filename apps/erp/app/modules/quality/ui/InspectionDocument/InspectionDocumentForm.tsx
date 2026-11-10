// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
    name?: string;
    partId: string;
  };
  open?: boolean;
  onClose: () => void;
};

export default function InspectionDocumentForm({
  initialValues,
  open = true,
  onClose
}: InspectionDocumentFormProps) {
  const { t } = useLingui();
  const isEditing = Boolean(initialValues.id);

  return (
    <Drawer open={open} onOpenChange={(open) => !open && onClose()}>
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
              {isEditing ? t`Edit Inspection Plan` : t`New Inspection Plan`}
            </DrawerTitle>
          </DrawerHeader>
          <DrawerBody>
            <VStack spacing={4}>
              {isEditing && <Hidden name="id" />}
              <Item name="partId" type="Part" />
              <Input
                name="name"
                label={t`Inspection Name`}
                termId="inspection-document-name"
                placeholder={t`e.g. R1234 Receipt`}
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
