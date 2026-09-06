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
import { useLingui } from "@lingui/react/macro";
import { useFetcher } from "react-router";
import { Hidden, Submit, TextArea } from "~/components/Form";
import { learnCertificateRevokeValidator } from "~/modules/resources";
import { path } from "~/utils/path";

type RevokeCertificateModalProps = {
  certificateId: string;
  learnerName: string;
  trackTitle: string;
  onClose: () => void;
};

const RevokeCertificateModal = ({
  certificateId,
  learnerName,
  trackTitle,
  onClose
}: RevokeCertificateModalProps) => {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent>
        <ValidatedForm
          method="post"
          validator={learnCertificateRevokeValidator}
          defaultValues={{ certificateId, reason: "" }}
          fetcher={fetcher}
          action={path.to.learnRevokeCertificate}
        >
          <ModalHeader>
            <ModalTitle>{t`Revoke this certificate?`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Hidden name="certificateId" />
            <VStack spacing={4}>
              <p className="text-sm text-muted-foreground">
                {t`${learnerName}'s ${trackTitle} certificate will immediately read as revoked, including on its public verification page. The reason is recorded on the certificate.`}
              </p>
              <TextArea name="reason" label={t`Reason`} />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Submit>{t`Revoke`}</Submit>
              <Button size="md" variant="solid" onClick={onClose}>
                {t`Cancel`}
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
};

export default RevokeCertificateModal;
