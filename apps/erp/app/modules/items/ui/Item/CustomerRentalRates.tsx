import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuEllipsisVertical, LuPencil, LuTrash } from "react-icons/lu";
import { useNavigate } from "react-router";
import { DateTime, New } from "~/components";
import { usePermissions } from "~/hooks";
import type { getCustomerItemRentalRates } from "~/modules/sales";
import RentalMoney from "~/modules/sales/ui/Rentals/RentalMoney";
import { path } from "~/utils/path";

type CustomerRentalRate = NonNullable<
  Awaited<ReturnType<typeof getCustomerItemRentalRates>>["data"]
>[number];

type CustomerRentalRatesProps = {
  itemId: string;
  rates: CustomerRentalRate[];
};

/** The rental rates agreed with particular customers or customer types for
 *  this item. The drawers are this route's children, rendered by the Sales
 *  tab's outlet. */
const CustomerRentalRates = ({ itemId, rates }: CustomerRentalRatesProps) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const canCreate = permissions.can("create", "sales");
  const canUpdate = permissions.can("update", "sales");
  const canDelete = permissions.can("delete", "sales");

  return (
    <Card>
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>
            <Trans>Customer Rental Rates</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Rates agreed with a customer, or with every customer of a type.
              They are the starting rate when this part is rented to them.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardAction>
          {canCreate && <New to={path.to.newCustomerRentalRate(itemId)} />}
        </CardAction>
      </HStack>
      <CardContent>
        {rates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No customer rental rates.</Trans>
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>
                  <Trans>Customer</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Day</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Week</Trans>
                </Th>
                <Th className="text-right">
                  <Trans>Month</Trans>
                </Th>
                <Th>
                  <Trans>Valid</Trans>
                </Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {rates.map((rate) => (
                <Tr key={rate.id}>
                  <Td>
                    {rate.customer?.name ??
                      (rate.customerType?.name
                        ? t`${rate.customerType.name} (type)`
                        : "—")}
                  </Td>
                  <Td className="text-right">
                    <RentalMoney
                      value={rate.dayRate}
                      currencyCode={rate.currencyCode}
                      rate
                    />
                  </Td>
                  <Td className="text-right">
                    <RentalMoney
                      value={rate.weekRate}
                      currencyCode={rate.currencyCode}
                      rate
                    />
                  </Td>
                  <Td className="text-right">
                    <RentalMoney
                      value={rate.monthRate}
                      currencyCode={rate.currencyCode}
                      rate
                    />
                  </Td>
                  <Td>
                    <span className="whitespace-nowrap">
                      {rate.validFrom || rate.validTo ? (
                        <>
                          {rate.validFrom ? (
                            <DateTime value={rate.validFrom} variant="date" />
                          ) : (
                            "…"
                          )}{" "}
                          –{" "}
                          {rate.validTo ? (
                            <DateTime value={rate.validTo} variant="date" />
                          ) : (
                            "…"
                          )}
                        </>
                      ) : (
                        <Trans>Always</Trans>
                      )}
                    </span>
                  </Td>
                  <Td className="w-8">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          aria-label={t`Actions`}
                          icon={<LuEllipsisVertical />}
                          size="sm"
                          variant="ghost"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={!canUpdate}
                          onClick={() =>
                            navigate(
                              path.to.customerRentalRate(itemId, rate.id)
                            )
                          }
                        >
                          <DropdownMenuIcon icon={<LuPencil />} />
                          <Trans>Edit</Trans>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          disabled={!canDelete}
                          onClick={() =>
                            navigate(
                              path.to.deleteCustomerRentalRate(itemId, rate.id)
                            )
                          }
                        >
                          <DropdownMenuIcon icon={<LuTrash />} />
                          <Trans>Delete</Trans>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default CustomerRentalRates;
