import { withRevisionSuffix } from "@carbon/documents/utils";
import { ValidatedForm } from "@carbon/form";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  HStack,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useEffect, useState } from "react";
import {
  LuChevronDown,
  LuDownload,
  LuEye,
  LuFileBadge,
  LuFilePlus,
  LuSend
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { CustomerContact, EmailRecipients } from "~/components/Form";
import { usePermissions } from "~/hooks";
import { useIntegrations } from "~/hooks/useIntegrations";
import { path } from "~/utils/path";
import { certificateOfConformanceSendValidator } from "../../inventory.models";
import type { CertificateOfConformance } from "../../types";
import CertificateOfConformanceIssueModal from "./CertificateOfConformanceIssueModal";

type CertificateLoaderData = {
  certificates: CertificateOfConformance[];
  customerId: string | null;
  defaultContactId: string | null;
};

type CertificateOfConformanceMenuProps = {
  shipmentId: string;
  isPosted: boolean;
};

const CertificateOfConformanceMenu = ({
  shipmentId,
  isPosted
}: CertificateOfConformanceMenuProps) => {
  const { t } = useLingui();
  const { locale } = useLocale();
  const permissions = usePermissions();
  const integrations = useIntegrations();
  const issueModal = useDisclosure();
  const [sending, setSending] = useState<CertificateOfConformance | null>(null);

  // Loaded with `load`, so it revalidates after the issue/send actions.
  const fetcher = useFetcher<CertificateLoaderData>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per shipment; the fetcher object changes every render.
  useEffect(() => {
    fetcher.load(path.to.shipmentCertificate(shipmentId));
  }, [shipmentId]);

  const certificates = fetcher.data?.certificates ?? [];
  const customerId = fetcher.data?.customerId ?? null;
  const defaultContactId = fetcher.data?.defaultContactId ?? null;
  const canUpdate =
    permissions.can("update", "inventory") && permissions.is("employee");
  const canSend = canUpdate && integrations.has("email") && !!customerId;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            leftIcon={<LuFileBadge />}
            rightIcon={<LuChevronDown />}
          >
            <Trans>Certificate</Trans>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[260px]">
          <DropdownMenuItem asChild>
            <a
              target="_blank"
              href={path.to.file.shipmentCertificate(shipmentId)}
              rel="noreferrer"
            >
              <DropdownMenuIcon icon={<LuEye />} />
              <Trans>Preview</Trans>
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!isPosted || !canUpdate || fetcher.state !== "idle"}
            onClick={issueModal.onOpen}
          >
            <DropdownMenuIcon icon={<LuFilePlus />} />
            {certificates.length > 0 ? (
              <Trans>Reissue…</Trans>
            ) : (
              <Trans>Issue…</Trans>
            )}
          </DropdownMenuItem>
          {certificates.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>
                <Trans>Issued</Trans>
              </DropdownMenuLabel>
              {certificates.map((certificate) => {
                const number = withRevisionSuffix(
                  certificate.certificateId,
                  certificate.revision
                );
                return (
                  <DropdownMenuSub key={certificate.id}>
                    <DropdownMenuSubTrigger>
                      <VStack spacing={0}>
                        <span>{number}</span>
                        <span className="text-xs text-muted-foreground">
                          {t`Signed ${formatDate(
                            certificate.signedAt,
                            undefined,
                            locale
                          )}`}
                          {certificate.lastSentAt
                            ? ` · ${t`Sent ${formatDate(
                                certificate.lastSentAt,
                                undefined,
                                locale
                              )}`}`
                            : ""}
                        </span>
                      </VStack>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem asChild>
                        <a
                          target="_blank"
                          href={path.to.file.shipmentCertificateRevision(
                            shipmentId,
                            certificate.revision
                          )}
                          rel="noreferrer"
                        >
                          <DropdownMenuIcon icon={<LuDownload />} />
                          <Trans>Download</Trans>
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={!canSend}
                        onClick={() => setSending(certificate)}
                      >
                        <DropdownMenuIcon icon={<LuSend />} />
                        <Trans>Send…</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                );
              })}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {issueModal.isOpen && (
        <CertificateOfConformanceIssueModal
          shipmentId={shipmentId}
          isReissue={certificates.length > 0}
          customerId={customerId}
          defaultContactId={defaultContactId}
          onClose={issueModal.onClose}
        />
      )}
      {sending && (
        <CertificateOfConformanceSendModal
          shipmentId={shipmentId}
          certificate={sending}
          customerId={customerId}
          defaultContactId={defaultContactId}
          onClose={() => setSending(null)}
        />
      )}
    </>
  );
};

function CertificateOfConformanceSendModal({
  shipmentId,
  certificate,
  customerId,
  defaultContactId,
  onClose
}: {
  shipmentId: string;
  certificate: CertificateOfConformance;
  customerId: string | null;
  defaultContactId: string | null;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success?: boolean; message?: string }>();
  const number = withRevisionSuffix(
    certificate.certificateId,
    certificate.revision
  );

  // The action flashes its own toast; the dialog only has to close.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onClose is stable for the modal's lifetime.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data]);

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
          action={path.to.shipmentCertificateSend(shipmentId, certificate.id)}
          validator={certificateOfConformanceSendValidator}
          defaultValues={{
            customerContact: defaultContactId ?? "",
            cc: []
          }}
          fetcher={fetcher}
        >
          <ModalHeader>
            <ModalTitle>{t`Send ${number}`}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <VStack spacing={4}>
              <CustomerContact
                name="customerContact"
                customer={customerId ?? undefined}
              />
              <EmailRecipients name="cc" label={t`CC`} type="employee" />
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                type="submit"
                leftIcon={<LuSend />}
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                <Trans>Send</Trans>
              </Button>
            </HStack>
          </ModalFooter>
        </ValidatedForm>
      </ModalContent>
    </Modal>
  );
}

export default CertificateOfConformanceMenu;
