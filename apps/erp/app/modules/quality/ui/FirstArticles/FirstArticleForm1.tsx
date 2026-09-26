import { ValidatedForm } from "@carbon/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { DateTime, Empty } from "~/components";
import { Hidden, Input, Select, Submit, TextArea } from "~/components/Form";
import { usePermissions } from "~/hooks";
import type { FirstArticleInspectionDetail } from "~/modules/quality/types";
import { path } from "~/utils/path";
import {
  firstArticleInspectionHeaderValidator,
  firstArticleInspectionReasons,
  firstArticleInspectionScopes
} from "../../quality.models";
import { useFirstArticleLabels } from "./useFirstArticleLabels";

type FirstArticleForm1Props = {
  detail: FirstArticleInspectionDetail;
  baselines: { id: string; label: string }[];
};

function Signature({
  label,
  name,
  title,
  at
}: {
  label: string;
  name: string | null;
  title: string | null;
  at: string | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {name ? (
        <>
          <span className="text-sm font-medium">
            {title ? `${name}, ${title}` : name}
          </span>
          {at && (
            <span className="text-xs text-muted-foreground">
              <DateTime value={at} />
            </span>
          )}
        </>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )}
    </div>
  );
}

/** AS9102 Form 1 — part number accountability. Editable while Draft. */
const FirstArticleForm1 = ({ detail, baselines }: FirstArticleForm1Props) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<{}>();
  const labels = useFirstArticleLabels();

  const { firstArticle } = detail;
  const isDraft = firstArticle.status === "Draft";
  const isDisabled = !isDraft || !permissions.can("update", "quality");
  const [scope, setScope] = useState(firstArticle.scope);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Form 1: Part Number Accountability</Trans>
        </CardTitle>
        <CardDescription>
          {labels.type(firstArticle.type)} ·{" "}
          {detail.serialNumber ? (
            <Trans>Serial {detail.serialNumber}</Trans>
          ) : (
            <Trans>No serial number</Trans>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <VStack spacing={8}>
          <ValidatedForm
            validator={firstArticleInspectionHeaderValidator}
            method="post"
            action={path.to.firstArticleHeader(firstArticle.id)}
            defaultValues={{
              id: firstArticle.id,
              partNumber: firstArticle.partNumber,
              partName: firstArticle.partName,
              partRevision: firstArticle.partRevision ?? "",
              drawingNumber: firstArticle.drawingNumber ?? "",
              drawingRevision: firstArticle.drawingRevision ?? "",
              additionalChanges: firstArticle.additionalChanges ?? "",
              manufacturingProcessReference:
                firstArticle.manufacturingProcessReference,
              organizationName: firstArticle.organizationName,
              supplierCode: firstArticle.supplierCode ?? "",
              purchaseOrderNumber: firstArticle.purchaseOrderNumber ?? "",
              scope: firstArticle.scope,
              reason: firstArticle.reason,
              baselineFirstArticleInspectionId:
                firstArticle.baselineFirstArticleInspectionId ?? "",
              baselineReference: firstArticle.baselineReference ?? "",
              comments: firstArticle.comments ?? ""
            }}
            fetcher={fetcher}
            isDisabled={isDisabled}
            className="w-full"
          >
            <Hidden name="id" />
            <VStack spacing={4}>
              <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-4">
                <Input name="partNumber" label={t`Part Number`} />
                <Input name="partName" label={t`Part Name`} />
                <Input name="partRevision" label={t`Part Revision`} />
                <Input
                  name="manufacturingProcessReference"
                  label={t`Manufacturing Process Reference`}
                />
                <Input name="drawingNumber" label={t`Drawing Number`} />
                <Input name="drawingRevision" label={t`Drawing Revision`} />
                <Input name="organizationName" label={t`Organization Name`} />
                <Input name="supplierCode" label={t`Supplier Code`} />
                <Input name="purchaseOrderNumber" label={t`PO Number`} />
                <Select
                  name="scope"
                  label={t`Scope`}
                  options={firstArticleInspectionScopes.map((value) => ({
                    value,
                    label: labels.scope(value)
                  }))}
                  onChange={(selected) =>
                    setScope(
                      (selected?.value as typeof scope | undefined) ?? "Full"
                    )
                  }
                />
                <Select
                  name="reason"
                  label={t`Reason`}
                  options={firstArticleInspectionReasons.map((value) => ({
                    value,
                    label: labels.reason(value)
                  }))}
                />
              </div>
              {scope === "Partial" && (
                <div className="grid w-full gap-4 grid-cols-1 md:grid-cols-2">
                  <Select
                    name="baselineFirstArticleInspectionId"
                    label={t`Baseline First Article`}
                    options={baselines.map((baseline) => ({
                      value: baseline.id,
                      label: baseline.label
                    }))}
                    isOptional
                  />
                  <Input
                    name="baselineReference"
                    label={t`External Baseline`}
                  />
                </div>
              )}
              <TextArea
                name="additionalChanges"
                label={t`Additional Changes`}
              />
              <TextArea name="comments" label={t`Comments`} />
              {!isDisabled && (
                <HStack>
                  <Submit hideShortcutKey>
                    <Trans>Save</Trans>
                  </Submit>
                </HStack>
              )}
            </VStack>
          </ValidatedForm>

          <VStack spacing={2}>
            <h3 className="text-sm font-medium">
              <Trans>Index of Parts and Sub-assemblies</Trans>
            </h3>
            {!detail.firstArticle.jobMakeMethodId ? (
              <Empty className="py-4">
                <Trans>
                  The job's make method no longer exists, so the index cannot be
                  derived.
                </Trans>
              </Empty>
            ) : detail.index.length === 0 ? (
              <Empty className="py-4">
                <Trans>None — a detail part.</Trans>
              </Empty>
            ) : (
              <Table>
                <Thead>
                  <Tr>
                    <Th>
                      <Trans>Part Number</Trans>
                    </Th>
                    <Th>
                      <Trans>Part Name</Trans>
                    </Th>
                    <Th>
                      <Trans>Part Type</Trans>
                    </Th>
                    <Th>
                      <Trans>FAI Report</Trans>
                    </Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {detail.index.map((row) => (
                    <Tr key={row.jobMaterialId}>
                      <Td>{row.partNumber}</Td>
                      <Td>{row.partName}</Td>
                      <Td>{labels.partType(row.partType)}</Td>
                      <Td>
                        {row.firstArticleInspectionId ? (
                          <Link
                            to={path.to.firstArticle(
                              row.firstArticleInspectionId
                            )}
                            className="underline-offset-2 hover:underline"
                          >
                            {row.fairIdentifier}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            <Trans>None approved</Trans>
                          </span>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </VStack>

          <div className="grid w-full gap-6 grid-cols-1 md:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                <Trans>Documented Nonconformance</Trans>
              </span>
              <span className="text-sm font-medium">
                {firstArticle.hasNonconformance === null ? (
                  "—"
                ) : firstArticle.hasNonconformance ? (
                  <Trans>Yes</Trans>
                ) : (
                  <Trans>No</Trans>
                )}
              </span>
            </div>
            <Signature
              label={t`FAI Complete (Verified)`}
              name={firstArticle.verifiedByName}
              title={firstArticle.verifiedByTitle}
              at={firstArticle.verifiedAt}
            />
            <Signature
              label={t`Reviewed (Approved)`}
              name={firstArticle.approvedByName}
              title={firstArticle.approvedByTitle}
              at={firstArticle.approvedAt}
            />
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                <Trans>Customer Approval</Trans>
              </span>
              <span className="text-sm font-medium">
                {firstArticle.customerApprovalName ?? "—"}
              </span>
              {firstArticle.customerApprovalDate && (
                <span className="text-xs text-muted-foreground">
                  {formatDate(firstArticle.customerApprovalDate)}
                </span>
              )}
            </div>
          </div>
        </VStack>
      </CardContent>
    </Card>
  );
};

export default FirstArticleForm1;
