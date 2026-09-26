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
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { Hidden, Input, Select, Submit, TextArea } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import {
  certificateTypes,
  customerApprovalVerifications,
  firstArticleInspectionProductValidator
} from "../../quality.models";
import { getCertificateTypeLabel } from "../Certificates/CertificateForm";
import { useFirstArticleLabels } from "./useFirstArticleLabels";

type FirstArticleProductFormProps = {
  initialValues: z.infer<typeof firstArticleInspectionProductValidator>;
  onClose: () => void;
};

/** One AS9102 Form 2 row: a material, special process or functional test. */
const FirstArticleProductForm = ({
  initialValues,
  onClose
}: FirstArticleProductFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const labels = useFirstArticleLabels();
  const fetcher = useFetcher<{}>();
  const isEditing = !!initialValues.id;

  // The action redirects back to the FAI; close once the submission settles.
  const submitted = useRef(false);
  useEffect(() => {
    if (fetcher.state !== "idle") {
      submitted.current = true;
    } else if (submitted.current) {
      submitted.current = false;
      onClose();
    }
  }, [fetcher.state, onClose]);

  return (
    <ModalDrawerProvider type="modal">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent>
          <ValidatedForm
            validator={firstArticleInspectionProductValidator}
            method="post"
            action={path.to.firstArticleProducts(
              initialValues.firstArticleInspectionId
            )}
            defaultValues={initialValues}
            fetcher={fetcher}
            className="flex flex-col h-full"
          >
            <ModalDrawerHeader>
              <ModalDrawerTitle>
                {isEditing ? <Trans>Edit Row</Trans> : <Trans>New Row</Trans>}
              </ModalDrawerTitle>
            </ModalDrawerHeader>
            <ModalDrawerBody>
              <Hidden name="id" />
              <Hidden name="firstArticleInspectionId" />
              <Hidden name="certificateId" />
              <VStack spacing={4}>
                <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
                  <Select
                    name="kind"
                    label={t`Kind`}
                    options={certificateTypes.map((value) => ({
                      value,
                      label: getCertificateTypeLabel(value, t)
                    }))}
                  />
                  <Input name="name" label={t`Material or Process Name`} />
                  <Input name="specification" label={t`Specification`} />
                  <Input name="code" label={t`Code`} />
                  <Input
                    name="supplier"
                    label={t`Special Process Supplier Code`}
                  />
                  <Select
                    name="customerApprovalVerification"
                    label={t`Customer Approval Verification`}
                    options={customerApprovalVerifications.map((value) => ({
                      value,
                      label: labels.verification(value)
                    }))}
                  />
                  <Input
                    name="certificateNumber"
                    label={t`Certificate of Conformance Number`}
                  />
                  <Input
                    name="functionalTestProcedureNumber"
                    label={t`Functional Test Procedure Number`}
                  />
                  <Input
                    name="acceptanceReportNumber"
                    label={t`Acceptance Report Number`}
                  />
                </div>
                <TextArea name="comments" label={t`Comments`} />
              </VStack>
            </ModalDrawerBody>
            <ModalDrawerFooter>
              <HStack>
                <Button variant="solid" onClick={onClose}>
                  <Trans>Cancel</Trans>
                </Button>
                <Submit isDisabled={!permissions.can("update", "quality")}>
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

export default FirstArticleProductForm;
