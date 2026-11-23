// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { richTextToPlainText } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  LuQrCode,
  LuSquareUser,
  LuTruck,
  LuUndo2,
  LuWrench
} from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime } from "~/components";
import {
  DocumentPage,
  DocumentPageHeader,
  DocumentSidebar,
  RelatedDocument,
  RelatedDocumentGroup
} from "~/components/DocumentPage";
import {
  CustomerLocation,
  DatePicker,
  Hidden,
  Submit
} from "~/components/Form";
import { usePermissions } from "~/hooks";
import SalesReturnOrderStatus from "~/modules/sales/ui/SalesReturnOrders/SalesReturnOrderStatus";
import { path } from "~/utils/path";
import { customerAssetUpdateValidator } from "../../service.models";
import type {
  CustomerAssetDetail,
  CustomerAssetReturnLine,
  CustomerAssetServiceJob
} from "../../types";
import { useCoverageLabels } from "../ServiceJob/CoverageBadge";
import ServiceJobStatus from "../ServiceJob/ServiceJobStatus";
import { ServiceRichText } from "../ServiceRichText";
import { CustomerAssetStatus, WarrantyBadge } from "../ServiceStatus";

type CustomerAssetPageProps = {
  asset: CustomerAssetDetail;
  serviceJobs: CustomerAssetServiceJob[];
  returnLines: CustomerAssetReturnLine[];
};

/**
 * A unit at a customer: who owns it, where it is and its warranty, the
 * service jobs worked on it and the RMA lines that returned it.
 */
export default function CustomerAssetPage({
  asset,
  serviceJobs,
  returnLines
}: CustomerAssetPageProps) {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canUpdate = permissions.can("update", "service");
  const canViewSales = permissions.can("view", "sales");
  const coverageLabels = useCoverageLabels();
  const returnTypeLabels = {
    "Return to Stock": t`Return to Stock`,
    "Return for Service": t`Return for Service`,
    "Return for Warranty": t`Return for Warranty`
  } as const;
  const serial = asset.trackedEntity?.readableId ?? "";
  const action = path.to.customerAsset(asset.id);
  const shipment = (
    asset as { shipment?: { id: string; shipmentId: string } | null }
  ).shipment;

  return (
    <DocumentPage
      header={
        <DocumentPageHeader
          title={serial}
          status={
            <>
              <CustomerAssetStatus status={asset.status} />
              <WarrantyBadge asset={asset} />
            </>
          }
          meta={[
            <span key="item">
              {[asset.item?.readableIdWithRevision, asset.item?.name]
                .filter(Boolean)
                .join(" · ")}
            </span>,
            <span key="customer">{asset.customer?.name}</span>,
            ...(asset.customerLocation?.name
              ? [<span key="site">{asset.customerLocation.name}</span>]
              : [])
          ]}
          actions={
            <Button
              leftIcon={<LuWrench />}
              isDisabled={!permissions.can("create", "service")}
              onClick={() =>
                navigate(
                  `${path.to.newServiceJob}?customerId=${asset.customerId}&customerAssetId=${asset.id}`
                )
              }
            >
              <Trans>New Service Job</Trans>
            </Button>
          }
        />
      }
      sidebar={
        <DocumentSidebar
          documents={
            <>
              <RelatedDocumentGroup>
                <RelatedDocument
                  to={path.to.customer(asset.customerId)}
                  icon={<LuSquareUser />}
                  title={asset.customer?.name ?? ""}
                  description={t`Customer`}
                />
                <RelatedDocument
                  to={`${path.to.traceabilityGraph}?trackedEntityId=${asset.trackedEntityId}`}
                  icon={<LuQrCode />}
                  title={serial}
                  description={t`Serial Number`}
                />
                {shipment && (
                  <RelatedDocument
                    to={path.to.shipment(shipment.id)}
                    icon={<LuTruck />}
                    title={shipment.shipmentId}
                    description={t`Shipment`}
                  />
                )}
              </RelatedDocumentGroup>
              {serviceJobs.length > 0 && (
                <RelatedDocumentGroup title={<Trans>Service Jobs</Trans>}>
                  {serviceJobs.map((job) => (
                    <RelatedDocument
                      key={job.id}
                      to={path.to.serviceJob(job.id)}
                      icon={<LuWrench />}
                      title={job.serviceJobId}
                      description={
                        richTextToPlainText(job.problem) ||
                        coverageLabels[job.coverage]
                      }
                      status={<ServiceJobStatus status={job.status} />}
                    />
                  ))}
                </RelatedDocumentGroup>
              )}
              {canViewSales && returnLines.length > 0 && (
                <RelatedDocumentGroup title={<Trans>Returns</Trans>}>
                  {returnLines.flatMap((line) =>
                    line.salesReturnOrder
                      ? [
                          <RelatedDocument
                            key={line.id}
                            to={path.to.salesReturnOrder(
                              line.salesReturnOrder.id
                            )}
                            icon={<LuUndo2 />}
                            title={line.salesReturnOrder.salesReturnOrderId}
                            description={returnTypeLabels[line.returnType]}
                            status={
                              <SalesReturnOrderStatus
                                status={line.salesReturnOrder.status}
                              />
                            }
                          />
                        ]
                      : []
                  )}
                </RelatedDocumentGroup>
              )}
            </>
          }
        />
      }
    >
      <Card>
        <ValidatedForm
          key={asset.updatedAt ?? asset.id}
          validator={customerAssetUpdateValidator}
          method="post"
          action={action}
          defaultValues={{
            id: asset.id,
            customerLocationId: asset.customerLocationId ?? undefined,
            laborWarrantyEndDate: asset.laborWarrantyEndDate ?? undefined,
            partsWarrantyEndDate: asset.partsWarrantyEndDate ?? undefined
          }}
          isDisabled={!canUpdate}
        >
          <CardHeader>
            <CardTitle>
              <Trans>Warranty and Site</Trans>
            </CardTitle>
            <CardDescription>
              {asset.shippedDate ? (
                <Trans>
                  Shipped <DateTime value={asset.shippedDate} variant="date" />
                </Trans>
              ) : (
                <Trans>No ship date</Trans>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Hidden name="intent" value="update" />
            <Hidden name="id" />
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-3">
              <CustomerLocation
                name="customerLocationId"
                label={t`Site`}
                customer={asset.customerId}
                isReadOnly={!canUpdate}
              />
              <DatePicker
                name="laborWarrantyEndDate"
                label={t`Labor Warranty Ends`}
                isDisabled={!canUpdate}
              />
              <DatePicker
                name="partsWarrantyEndDate"
                label={t`Parts Warranty Ends`}
                isDisabled={!canUpdate}
              />
            </div>
          </CardContent>
          <CardFooter>
            <Submit isDisabled={!canUpdate}>
              <Trans>Save</Trans>
            </Submit>
          </CardFooter>
        </ValidatedForm>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Notes</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ServiceRichText
            key={asset.id}
            action={action}
            field="notes"
            value={asset.notes}
            isDisabled={!canUpdate}
            empty={<Trans>No notes</Trans>}
          />
        </CardContent>
      </Card>
    </DocumentPage>
  );
}
