// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  useDisclosure
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuPencil, LuTrash } from "react-icons/lu";
import { Outlet, useNavigate } from "react-router";
import { New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

export type CustomerTransitTime = {
  id: string;
  customerLocationId: string;
  shippingMethodId: string;
  transitDays: number;
  customerLocation: { name: string } | null;
  shippingMethod: { name: string } | null;
};

type CustomerTransitTimesProps = {
  customerId: string;
  transitTimes: CustomerTransitTime[];
};

/**
 * The transit days of each ship-to address and shipping method pair. Each
 * row wins over the shipping method's own transit days for orders to that
 * address.
 */
const CustomerTransitTimes = ({
  customerId,
  transitTimes
}: CustomerTransitTimesProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const deleteModal = useDisclosure();
  const [selected, setSelected] = useState<CustomerTransitTime | null>(null);

  return (
    <>
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>
              <Trans>Transit Times</Trans>
            </CardTitle>
            <CardDescription>
              <Trans>
                Business days a shipment to a ship-to address takes with a
                shipping method. They replace the shipping method's transit
                days.
              </Trans>
            </CardDescription>
          </CardHeader>
          <CardAction>
            {permissions.can("create", "sales") && (
              <New to={path.to.newCustomerTransitTime(customerId)} />
            )}
          </CardAction>
        </HStack>
        <CardContent>
          {transitTimes.length === 0 ? (
            <p className="w-full my-8 text-center text-muted-foreground text-sm">
              <Trans>
                No transit times yet. Orders use the shipping method's transit
                days.
              </Trans>
            </p>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>
                    <Trans>Ship To</Trans>
                  </Th>
                  <Th>
                    <Trans>Shipping Method</Trans>
                  </Th>
                  <Th>
                    <Trans>Transit Days</Trans>
                  </Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {transitTimes.map((row) => (
                  <Tr key={row.id}>
                    <Td>{row.customerLocation?.name}</Td>
                    <Td>{row.shippingMethod?.name}</Td>
                    <Td className="tabular-nums">{row.transitDays}</Td>
                    <Td className="text-right">
                      <HStack spacing={1} className="justify-end">
                        {permissions.can("update", "sales") && (
                          <IconButton
                            aria-label={t`Edit`}
                            icon={<LuPencil />}
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate(
                                path.to.customerTransitTime(customerId, row.id)
                              )
                            }
                          />
                        )}
                        {permissions.can("delete", "sales") && (
                          <IconButton
                            aria-label={t`Delete`}
                            icon={<LuTrash />}
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelected(row);
                              deleteModal.onOpen();
                            }}
                          />
                        )}
                      </HStack>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <ConfirmDelete
          action={path.to.deleteCustomerTransitTime(customerId, selected.id)}
          isOpen={deleteModal.isOpen}
          name={`${selected.customerLocation?.name ?? ""} · ${selected.shippingMethod?.name ?? ""}`}
          text={t`Are you sure you want to delete these transit days?`}
          onCancel={deleteModal.onClose}
          onSubmit={deleteModal.onClose}
        />
      )}

      <Outlet />
    </>
  );
};

export default CustomerTransitTimes;
