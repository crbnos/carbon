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
  CardTitle,
  LabelWithHelp,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuClipboardList, LuSquareUser, LuTruck } from "react-icons/lu";
import { Link } from "react-router";
import { DateTime, Hyperlink } from "~/components";
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
import { useCurrencyFormatter, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerAssetUpdateValidator } from "../../service.models";
import type { ComponentHistoryRow } from "../../service.service";
import type {
  CustomerAssetComponent,
  CustomerAssetDetail,
  ServiceOrderListItem
} from "../../types";
import { ServiceRichText } from "../ServiceRichText";
import {
  CustomerAssetStatus,
  ServiceOrderStatus,
  WarrantyBadge
} from "../ServiceStatus";
import ComponentHistory from "./ComponentHistory";

type CustomerAssetPageProps = {
  asset: CustomerAssetDetail;
  components: CustomerAssetComponent[];
  orders: ServiceOrderListItem[];
  orderCosts: Record<string, number>;
  history: ComponentHistoryRow[];
};

/**
 * A unit at a customer: who owns it, where it is, its warranty, what has
 * been fitted to it and what its service has cost. The next step is a new
 * service order for it.
 */
export default function CustomerAssetPage({
  asset,
  components,
  orders,
  orderCosts,
  history
}: CustomerAssetPageProps) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const formatCurrency = useCurrencyFormatter();
  const canUpdate = permissions.can("update", "service");
  // A field visit needs a unit at the customer.
  const canCreateOrder =
    permissions.can("create", "service") && asset.status === "In Service";
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
            canCreateOrder ? (
              <Button asChild variant="primary" leftIcon={<LuClipboardList />}>
                <Link
                  to={`${path.to.newServiceOrder}?customerAssetId=${asset.id}`}
                >
                  <Trans>New Service Order</Trans>
                </Link>
              </Button>
            ) : (
              <Button
                variant="primary"
                leftIcon={<LuClipboardList />}
                isDisabled
              >
                <Trans>New Service Order</Trans>
              </Button>
            )
          }
        />
      }
      sidebar={
        <DocumentSidebar
          documents={
            <RelatedDocumentGroup>
              <RelatedDocument
                to={path.to.customer(asset.customerId)}
                icon={<LuSquareUser />}
                title={asset.customer?.name ?? ""}
                description={t`Customer`}
              />
              {shipment && (
                <RelatedDocument
                  to={path.to.shipment(shipment.id)}
                  icon={<LuTruck />}
                  title={shipment.shipmentId}
                  description={t`Shipment`}
                />
              )}
              {orders.map((order) => (
                <RelatedDocument
                  key={order.id}
                  to={path.to.serviceOrder(order.id)}
                  icon={<LuClipboardList />}
                  title={order.serviceOrderId}
                  description={t`Service Order`}
                  status={<ServiceOrderStatus status={order.status} />}
                />
              ))}
            </RelatedDocumentGroup>
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

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Installed Components</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Parts fitted by a service order, with their own parts warranty.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {components.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>No service order has fitted a part to this unit.</Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Item</Trans>
                  </Th>
                  <Th>
                    <Trans>Serial</Trans>
                  </Th>
                  <Th>
                    <Trans>Installed</Trans>
                  </Th>
                  <Th>
                    <Trans>Parts Warranty Ends</Trans>
                  </Th>
                  <Th>
                    <Trans>Removed</Trans>
                  </Th>
                  <Th>
                    <LabelWithHelp termId="service-order" variant="inline">
                      <Trans>Service Order</Trans>
                    </LabelWithHelp>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {components.map((component) => (
                  <Tr
                    key={component.id}
                    className={
                      component.removedDate ? "text-muted-foreground" : ""
                    }
                  >
                    <Td>
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">
                          {component.item?.readableIdWithRevision}
                        </span>
                        {component.item?.name && (
                          <span className="text-xs text-muted-foreground truncate">
                            {component.item.name}
                          </span>
                        )}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {component.trackedEntity?.readableId ?? "—"}
                    </Td>
                    <Td>
                      <DateTime
                        value={component.installedDate}
                        variant="date"
                        fallback="—"
                      />
                    </Td>
                    <Td>
                      <DateTime
                        value={component.partsWarrantyEndDate}
                        variant="date"
                        fallback="—"
                      />
                    </Td>
                    <Td>
                      <DateTime
                        value={component.removedDate}
                        variant="date"
                        fallback="—"
                      />
                    </Td>
                    <Td className="whitespace-nowrap">
                      {component.serviceOrder ? (
                        <Hyperlink
                          to={path.to.serviceOrder(component.serviceOrder.id)}
                        >
                          {component.serviceOrder.serviceOrderId}
                        </Hyperlink>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>History by Order</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>This unit has no service orders yet.</Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <LabelWithHelp termId="service-order" variant="inline">
                      <Trans>Service Order</Trans>
                    </LabelWithHelp>
                  </Th>
                  <Th>
                    <Trans>Status</Trans>
                  </Th>
                  <Th>
                    <Trans>Opened</Trans>
                  </Th>
                  <Th>
                    <Trans>Completed</Trans>
                  </Th>
                  <Th className="text-right">
                    <Trans>Cost</Trans>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {orders.map((order) => (
                  <Tr key={order.id}>
                    <Td className="whitespace-nowrap">
                      <Hyperlink to={path.to.serviceOrder(order.id)}>
                        {order.serviceOrderId}
                      </Hyperlink>
                    </Td>
                    <Td>
                      <ServiceOrderStatus status={order.status} />
                    </Td>
                    <Td>
                      <DateTime value={order.createdAt} variant="date" />
                    </Td>
                    <Td>
                      <DateTime
                        value={order.completedAt}
                        variant="date"
                        fallback="—"
                      />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency.format(orderCosts[order.projectId] ?? 0)}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ComponentHistory rows={history} />
    </DocumentPage>
  );
}
