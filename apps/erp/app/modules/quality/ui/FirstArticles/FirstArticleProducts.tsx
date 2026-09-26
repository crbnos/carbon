import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import {
  LuPaperclip,
  LuPencil,
  LuPlus,
  LuRefreshCw,
  LuTrash,
  LuTriangleAlert
} from "react-icons/lu";
import { useFetcher } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import type {
  FirstArticleInspectionDetail,
  FirstArticleInspectionProduct
} from "~/modules/quality/types";
import { path } from "~/utils/path";
import CertificateForm, {
  getCertificateTypeLabel
} from "../Certificates/CertificateForm";
import FirstArticleProductForm from "./FirstArticleProductForm";
import { useFirstArticleLabels } from "./useFirstArticleLabels";

const NO_CERTIFICATE = "No certificate on file";

type FirstArticleProductsProps = {
  detail: FirstArticleInspectionDetail;
};

/**
 * AS9102 Form 2 — materials, special processes and functional tests, seeded
 * from the job's certification lineage and editable while Draft.
 */
const FirstArticleProducts = ({ detail }: FirstArticleProductsProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const labels = useFirstArticleLabels();
  const refreshFetcher = useFetcher<{}>();
  const deleteFetcher = useFetcher<{}>();
  const certificateModal = useDisclosure();
  const [editing, setEditing] = useState<FirstArticleInspectionProduct | null>(
    null
  );
  const [adding, setAdding] = useState(false);

  const { firstArticle } = detail;
  const id = firstArticle.id;
  const isEditable =
    firstArticle.status === "Draft" && permissions.can("update", "quality");

  return (
    <Card>
      <HStack className="w-full justify-between">
        <CardHeader>
          <CardTitle>
            <Trans>Form 2: Product Accountability</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Raw material, special processes and functional tests</Trans>
          </CardDescription>
        </CardHeader>
        <CardAction>
          <HStack>
            <Button
              variant="secondary"
              leftIcon={<LuRefreshCw />}
              isDisabled={!isEditable || refreshFetcher.state !== "idle"}
              isLoading={refreshFetcher.state !== "idle"}
              onClick={() =>
                refreshFetcher.submit(
                  {},
                  { method: "post", action: path.to.firstArticleRefresh(id) }
                )
              }
            >
              <Trans>Refresh from Traceability</Trans>
            </Button>
            <Button
              variant="secondary"
              leftIcon={<LuPaperclip />}
              isDisabled={!isEditable || detail.operations.length === 0}
              onClick={certificateModal.onOpen}
            >
              <Trans>Attach Certificate</Trans>
            </Button>
            <Button
              variant="secondary"
              leftIcon={<LuPlus />}
              isDisabled={!isEditable}
              onClick={() => setAdding(true)}
            >
              <Trans>Add Row</Trans>
            </Button>
          </HStack>
        </CardAction>
      </HStack>
      <CardContent>
        {detail.products.length === 0 ? (
          <Empty className="py-6">
            <Trans>
              No materials, special processes or functional tests yet.
            </Trans>
          </Empty>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Material or Process</Trans>
                </Th>
                <Th>
                  <Trans>Specification</Trans>
                </Th>
                <Th>
                  <Trans>Code</Trans>
                </Th>
                <Th>
                  <Trans>Supplier</Trans>
                </Th>
                <Th>
                  <Trans>Customer Approval</Trans>
                </Th>
                <Th>
                  <Trans>Certificate</Trans>
                </Th>
                <Th>
                  <Trans>Test Procedure</Trans>
                </Th>
                <Th>
                  <Trans>Acceptance Report</Trans>
                </Th>
                <Th>
                  <Trans>Comments</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {detail.products.map((product) => {
                const missing =
                  !product.certificateId &&
                  !product.certificateNumber &&
                  product.comments === NO_CERTIFICATE;
                return (
                  <Tr key={product.id}>
                    <Td>
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {product.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {getCertificateTypeLabel(product.kind, t)}
                        </span>
                      </div>
                    </Td>
                    <Td>{product.specification ?? ""}</Td>
                    <Td>{product.code ?? ""}</Td>
                    <Td>{product.supplier ?? ""}</Td>
                    <Td>
                      {labels.verification(
                        product.customerApprovalVerification
                      )}
                    </Td>
                    <Td>
                      {missing ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="flex items-center gap-1 text-yellow-600">
                              <LuTriangleAlert />
                              <Trans>Missing</Trans>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <Trans>No certificate on file</Trans>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        (product.certificateNumber ?? "")
                      )}
                    </Td>
                    <Td>{product.functionalTestProcedureNumber ?? ""}</Td>
                    <Td>{product.acceptanceReportNumber ?? ""}</Td>
                    <Td>{missing ? "" : (product.comments ?? "")}</Td>
                    <Td>
                      <HStack spacing={1}>
                        <IconButton
                          aria-label={t`Edit row`}
                          variant="ghost"
                          size="sm"
                          icon={<LuPencil />}
                          isDisabled={!isEditable}
                          onClick={() => setEditing(product)}
                        />
                        <IconButton
                          aria-label={t`Delete row`}
                          variant="ghost"
                          size="sm"
                          icon={<LuTrash />}
                          isDisabled={
                            !isEditable || deleteFetcher.state !== "idle"
                          }
                          onClick={() =>
                            deleteFetcher.submit(
                              {},
                              {
                                method: "post",
                                action: path.to.firstArticleProductDelete(
                                  id,
                                  product.id
                                )
                              }
                            )
                          }
                        />
                      </HStack>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </CardContent>

      {(adding || editing) && (
        <FirstArticleProductForm
          initialValues={
            editing
              ? {
                  id: editing.id,
                  firstArticleInspectionId: id,
                  kind: editing.kind,
                  name: editing.name,
                  specification: editing.specification ?? "",
                  code: editing.code ?? "",
                  supplier: editing.supplier ?? "",
                  certificateNumber: editing.certificateNumber ?? "",
                  certificateId: editing.certificateId ?? "",
                  functionalTestProcedureNumber:
                    editing.functionalTestProcedureNumber ?? "",
                  acceptanceReportNumber: editing.acceptanceReportNumber ?? "",
                  comments: editing.comments ?? "",
                  customerApprovalVerification:
                    editing.customerApprovalVerification
                }
              : {
                  firstArticleInspectionId: id,
                  kind: "Material",
                  name: "",
                  customerApprovalVerification: "N/A"
                }
          }
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}

      {certificateModal.isOpen && (
        <ModalDrawerProvider type="drawer">
          <ModalDrawer
            open
            onOpenChange={(open) => {
              if (!open) certificateModal.onClose();
            }}
          >
            <ModalDrawerContent>
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  <Trans>Attach Certificate</Trans>
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>
                <CertificateForm
                  jobOperation={{
                    options: detail.operations,
                    action: path.to.firstArticleCertificates(id),
                    uploadFolder: `job/${firstArticle.jobId}`
                  }}
                  // The action's revalidation reloads Form 2 with the
                  // refreshed rows; saving only closes the drawer.
                  onSaved={certificateModal.onClose}
                />
              </ModalDrawerBody>
            </ModalDrawerContent>
          </ModalDrawer>
        </ModalDrawerProvider>
      )}
    </Card>
  );
};

export default FirstArticleProducts;
