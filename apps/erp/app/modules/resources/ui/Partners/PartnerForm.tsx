// import { ValidatedForm } from "@carbon/form";
// import {
//   Button,
//   Drawer,
//   DrawerBody,
//   DrawerContent,
//   DrawerDescription,
//   DrawerFooter,
//   DrawerHeader,
//   DrawerTitle,
//   HStack,
//   VStack,
// } from "@carbon/react";
// import { useNavigate } from "@remix-run/react";
// import { useState } from "react";
import type { z } from "zod";
// import {
//   CustomFormFields,
//   Number,
//   Submit,
//   Supplier,
//   SupplierLocation,
// } from "~/components/Form";
// import { usePermissions } from "~/hooks";
import type { partnerValidator } from "~/modules/resources";
// import { path } from "~/utils/path";

type PartnerFormProps = {
  initialValues: z.infer<typeof partnerValidator>;
};

const PartnerForm = ({ initialValues }: PartnerFormProps) => {
  // const permissions = usePermissions();
  // const navigate = useNavigate();
  // const onClose = () => navigate(-1);
  // const [supplier, setSupplier] = useState<string | null>(
  //   initialValues.supplierId ?? null
  // );

  // const isEditing = initialValues.id !== "";
  // const isDisabled = isEditing
  //   ? !permissions.can("update", "resources")
  //   : !permissions.can("create", "resources");

  // const onSupplierChange = (newValue: { value: string } | null) => {
  //   if (newValue) setSupplier(newValue?.value ?? null);
  // };

  return null;

  // return (
  //   <Drawer
  //     open
  //     onOpenChange={(open) => {
  //       if (!open) onClose();
  //     }}
  //   >
  //     <DrawerContent>
  //       <ValidatedForm
  //         validator={partnerValidator}
  //         method="post"
  //         action={
  //           isEditing
  //             ? path.to.partner(initialValues.id, initialValues.abilityId)
  //             : path.to.newPartner
  //         }
  //         defaultValues={initialValues}
  //         className="flex flex-col h-full"
  //       >
  //         <DrawerHeader>
  //           <DrawerTitle>{isEditing ? "Edit" : "New"} Partner</DrawerTitle>
  //           <DrawerDescription>
  //             A partner is combination of a supplier location and and an ability
  //             with a certain amount of time available
  //           </DrawerDescription>
  //         </DrawerHeader>
  //         <DrawerBody>
  //           <VStack spacing={4}>
  //             <Supplier
  //               name="supplierId"
  //               label="Supplier"
  //               disabled={isEditing}
  //               onChange={onSupplierChange}
  //             />
  //             <SupplierLocation
  //               name="id"
  //               supplier={supplier ?? undefined}
  //               disabled={isEditing}
  //             />
  //             {/* <Ability name="abilityId" label="Ability" /> */}
  //             <Number
  //               name="hoursPerWeek"
  //               label="Hours per Week"
  //               helperText="The number of hours per week the supplier is available to work."
  //               minValue={0}
  //               maxValue={10000}
  //             />
  //             <CustomFormFields table="partner" />
  //           </VStack>
  //         </DrawerBody>
  //         <DrawerFooter>
  //           <HStack>
  //             <Submit isDisabled={isDisabled}>Save</Submit>
  //             <Button size="md" variant="solid" onClick={onClose}>
  //               Cancel
  //             </Button>
  //           </HStack>
  //         </DrawerFooter>
  //       </ValidatedForm>
  //     </DrawerContent>
  //   </Drawer>
  // );
};

export default PartnerForm;
