import {
  Button,
  Heading,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect } from "react";
import { LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Empty } from "~/components";
import { path } from "~/utils/path";
import type { Certificate } from "../../types";
import CertificateForm, { getCertificateTypeLabel } from "./CertificateForm";

type CertificatesDrawerProps = {
  receiptLineId: string;
  isReadOnly?: boolean;
  onClose: () => void;
};

const CertificatesDrawer = ({
  receiptLineId,
  isReadOnly = false,
  onClose
}: CertificatesDrawerProps) => {
  const { t } = useLingui();
  const loader = useFetcher<{
    certificates: Certificate[];
    supplierId: string | null;
  }>();
  const deleteFetcher = useFetcher<{ success: boolean; message: string }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher.load is stable per fetcher
  const load = useCallback(() => {
    loader.load(path.to.receiptLineCertificates(receiptLineId));
  }, [receiptLineId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (deleteFetcher.state !== "idle" || !deleteFetcher.data) return;
    if (deleteFetcher.data.success) {
      toast.success(t`Certificate deleted`);
      load();
    } else {
      toast.error(deleteFetcher.data.message);
    }
  }, [deleteFetcher.state, deleteFetcher.data, load, t]);

  const onDelete = (certificateId: string) => {
    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("certificateId", certificateId);
    deleteFetcher.submit(formData, {
      method: "post",
      action: path.to.receiptLineCertificates(receiptLineId)
    });
  };

  const certificates = loader.data?.certificates ?? [];
  const isLoaded = loader.data !== undefined;

  return (
    <ModalDrawerProvider type="drawer">
      <ModalDrawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <ModalDrawerContent size="lg">
          <ModalDrawerHeader>
            <ModalDrawerTitle>
              <Trans>Certificates</Trans>
            </ModalDrawerTitle>
          </ModalDrawerHeader>
          <ModalDrawerBody>
            <VStack spacing={8}>
              {certificates.length === 0 ? (
                isLoaded && (
                  <Empty className="py-6">
                    <Trans>No certificates on this line yet.</Trans>
                  </Empty>
                )
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>
                        <Trans>Type</Trans>
                      </Th>
                      <Th>
                        <Trans>Number</Trans>
                      </Th>
                      <Th>
                        <Trans>Specification</Trans>
                      </Th>
                      <Th>
                        <Trans>Supplier</Trans>
                      </Th>
                      <Th>
                        <Trans>File</Trans>
                      </Th>
                      <Th />
                    </Tr>
                  </Thead>
                  <Tbody>
                    {certificates.map((certificate) => (
                      <Tr key={certificate.id}>
                        <Td>{getCertificateTypeLabel(certificate.type, t)}</Td>
                        <Td>{certificate.certificateNumber}</Td>
                        <Td>{certificate.specification ?? ""}</Td>
                        <Td>{certificate.supplier?.name ?? ""}</Td>
                        <Td>
                          {certificate.document?.path ? (
                            <a
                              className="text-sm underline"
                              href={path.to.file.previewFile(
                                `private/${certificate.document.path}`
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {certificate.document.name}
                            </a>
                          ) : null}
                        </Td>
                        <Td>
                          <IconButton
                            aria-label={t`Delete certificate`}
                            variant="ghost"
                            size="sm"
                            icon={<LuTrash />}
                            isDisabled={
                              isReadOnly || deleteFetcher.state !== "idle"
                            }
                            onClick={() => onDelete(certificate.id)}
                          />
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              )}

              {!isReadOnly && isLoaded && (
                <VStack spacing={4}>
                  <Heading size="h4">
                    <Trans>Add Certificate</Trans>
                  </Heading>
                  <CertificateForm
                    receiptLineId={receiptLineId}
                    supplierId={loader.data?.supplierId}
                    onSaved={load}
                  />
                </VStack>
              )}
            </VStack>
          </ModalDrawerBody>
          <ModalDrawerFooter>
            <Button variant="solid" onClick={onClose}>
              <Trans>Close</Trans>
            </Button>
          </ModalDrawerFooter>
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default CertificatesDrawer;
