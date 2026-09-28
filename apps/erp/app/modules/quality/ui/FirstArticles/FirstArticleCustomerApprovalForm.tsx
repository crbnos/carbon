import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import { DatePicker, Hidden, Input, Submit } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { firstArticleCustomerApprovalValidator } from "../../quality.models";

type FirstArticleCustomerApprovalFormProps = {
  initialValues: z.infer<typeof firstArticleCustomerApprovalValidator>;
  onClose: () => void;
};

/** AS9102 fields 24/25 — the only edit an approved first article takes. */
const FirstArticleCustomerApprovalForm = ({
  initialValues,
  onClose
}: FirstArticleCustomerApprovalFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();

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
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          validator={firstArticleCustomerApprovalValidator}
          method="post"
          action={path.to.firstArticleCustomerApproval(initialValues.id)}
          defaultValues={initialValues}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>
              <Trans>Customer Approval</Trans>
            </ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="id" />
            <VStack spacing={4}>
              <Input
                name="customerApprovalName"
                label={t`Approved By (Customer)`}
              />
              <DatePicker name="customerApprovalDate" label={t`Date`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="solid" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Submit isDisabled={!permissions.can("update", "quality")}>
                <Trans>Save</Trans>
              </Submit>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default FirstArticleCustomerApprovalForm;
