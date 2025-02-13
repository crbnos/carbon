import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tr,
  useDisclosure,
} from "@carbon/react";
import { useFetcher, useParams } from "@remix-run/react";
import { LuCirclePlus } from "react-icons/lu";
import { Empty, Hyperlink } from "~/components";

import { usePermissions } from "~/hooks";

import { path } from "~/utils/path";
import type {
  Opportunity,
  SalesOrder,
  SalesOrderLine,
  SalesOrderLineShipment,
} from "../../types";

import { ShipmentStatus } from "~/modules/inventory/ui/Shipments";

type SalesOrderLineShipmentsProps = {
  salesOrder: SalesOrder;
  line: SalesOrderLine;
  opportunity: Opportunity;
  shipments: SalesOrderLineShipment[];
};

export function SalesOrderLineShipments({
  line,
  shipments,
}: SalesOrderLineShipmentsProps) {
  const permissions = usePermissions();
  const { orderId, lineId } = useParams();
  if (!orderId) throw new Error("orderId not found");
  if (!lineId) throw new Error("lineId not found");

  const newJobDisclosure = useDisclosure();
  const hasShipments = shipments.length > 0;

  const totalShipmentQuantity = shipments.reduce(
    (sum, shipment) => sum + (shipment.shippedQuantity ?? 0),
    0
  );
  const quantityRequired = (line.saleQuantity ?? 0) - totalShipmentQuantity;

  const fetcher = useFetcher<{ success: boolean }>();

  return (
    <>
      <Card>
        <HStack className="w-full justify-between">
          <CardHeader>
            <CardTitle>Shipments</CardTitle>
          </CardHeader>
          <CardAction>
            {permissions.can("create", "inventory") &&
              hasShipments &&
              quantityRequired > 0 && (
                <fetcher.Form
                  method="post"
                  action={path.to.newSalesOrderLineShipment(orderId, lineId)}
                >
                  <Button
                    type="submit"
                    leftIcon={<LuCirclePlus />}
                    onClick={newJobDisclosure.onOpen}
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={fetcher.state !== "idle"}
                  >
                    New Shipment
                  </Button>
                </fetcher.Form>
              )}
          </CardAction>
        </HStack>

        <CardContent>
          {shipments.length > 0 ? (
            <Table>
              <Thead>
                <Tr>
                  <Th>Shipment</Th>
                  <Th>Quantity</Th>
                </Tr>
              </Thead>
              <Tbody>
                {Object.entries(
                  shipments.reduce((acc, shipment) => {
                    const key = shipment.shipment.id!;
                    if (!acc[key]) {
                      acc[key] = [];
                    }
                    acc[key].push(shipment);
                    return acc;
                  }, {} as Record<string, typeof shipments>)
                ).map(([shipmentId, groupedShipments]) => (
                  <Tr key={shipmentId}>
                    <Td>
                      <HStack>
                        <Hyperlink to={path.to.shipment(shipmentId)}>
                          {groupedShipments[0].shipment.shipmentId}
                        </Hyperlink>
                        <ShipmentStatus
                          status={groupedShipments[0].shipment.status}
                        />
                      </HStack>
                    </Td>
                    <Td>
                      {groupedShipments.reduce(
                        (sum, shipment) =>
                          sum + (shipment.shippedQuantity ?? 0),
                        0
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
              <Tfoot className="border-t border-border">
                <Tr>
                  <Td />
                  <Td>{totalShipmentQuantity}</Td>
                </Tr>
              </Tfoot>
            </Table>
          ) : (
            <Empty className="pb-12">
              {permissions.can("create", "inventory") && (
                <fetcher.Form
                  method="post"
                  action={path.to.newSalesOrderLineShipment(orderId, lineId)}
                >
                  <Button
                    type="submit"
                    leftIcon={<LuCirclePlus />}
                    onClick={newJobDisclosure.onOpen}
                    isLoading={fetcher.state !== "idle"}
                    isDisabled={fetcher.state !== "idle"}
                  >
                    New Shipment
                  </Button>
                </fetcher.Form>
              )}
            </Empty>
          )}
        </CardContent>
      </Card>
    </>
  );
}
