import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  HStack,
  IconButton,
  Table as ReactTable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCirclePlus, LuTrash } from "react-icons/lu";
import { useFetcher, useNavigate, useParams } from "react-router";
import { Enumerable } from "~/components/Enumerable";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";

type CustomerWarrantyRule = {
  id: string | null;
  itemId: string | null;
  itemReadableId: string | null;
  itemName: string | null;
  warrantyTermName: string | null;
  coversParts: boolean | null;
  partsDurationMonths: number | null;
  coversLabor: boolean | null;
  laborDurationMonths: number | null;
  startBasis: string | null;
};

type CustomerWarrantiesProps = {
  rules: CustomerWarrantyRule[];
};

// A covered class with no duration is lifetime — an empty cell would read as
// "not covered", which is the opposite.
const duration = (covers: boolean | null, months: number | null) =>
  !covers ? "—" : months === null ? "Lifetime" : `${months} months`;

const CustomerWarranties = ({ rules }: CustomerWarrantiesProps) => {
  const { t } = useLingui();
  const { customerId } = useParams();
  const navigate = useNavigate();
  const permissions = usePermissions();
  const fetcher = useFetcher();

  if (!customerId) throw new Error("Could not find customerId");
  const canUpdate = permissions.can("update", "sales");

  return (
    <VStack spacing={4} className="w-full p-4">
      <Card>
        <CardHeader>
          <HStack className="w-full justify-between">
            <VStack spacing={1}>
              <CardTitle>
                <Trans>Warranties</Trans>
              </CardTitle>
              <CardDescription>
                <Trans>
                  What this customer gets. A rule for a specific part beats the
                  catch-all rule, and both beat the part's own default — so the
                  same battery can carry two years here and one year elsewhere.
                </Trans>
              </CardDescription>
            </VStack>
            {canUpdate && (
              <Button
                leftIcon={<LuCirclePlus />}
                onClick={() =>
                  navigate(path.to.customerWarrantyTermNew(customerId))
                }
              >
                <Trans>Add Rule</Trans>
              </Button>
            )}
          </HStack>
        </CardHeader>
        <CardContent>
          <ReactTable>
            <Thead>
              <Tr>
                <Th>{t`Applies to`}</Th>
                <Th>{t`Warranty Term`}</Th>
                <Th>{t`Parts`}</Th>
                <Th>{t`Labor`}</Th>
                <Th>{t`Starts on`}</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {rules.length === 0 && (
                <Tr>
                  <Td colSpan={6} className="text-muted-foreground text-center">
                    <Trans>
                      No rules — sales to this customer fall back to each part's
                      own warranty term.
                    </Trans>
                  </Td>
                </Tr>
              )}
              {rules.map((rule) => (
                <Tr key={rule.id}>
                  <Td>
                    {rule.itemId ? (
                      <div className="flex flex-col">
                        <span>{rule.itemReadableId}</span>
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {rule.itemName}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        <Trans>Every item</Trans>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <Enumerable value={rule.warrantyTermName ?? "—"} />
                  </Td>
                  <Td>
                    {duration(rule.coversParts, rule.partsDurationMonths)}
                  </Td>
                  <Td>
                    {duration(rule.coversLabor, rule.laborDurationMonths)}
                  </Td>
                  <Td>
                    <Enumerable value={rule.startBasis ?? "—"} />
                  </Td>
                  <Td>
                    {canUpdate && (
                      <IconButton
                        aria-label={t`Delete rule`}
                        variant="ghost"
                        icon={<LuTrash />}
                        onClick={() =>
                          fetcher.submit(
                            {},
                            {
                              method: "post",
                              action: path.to.customerWarrantyTermDelete(
                                customerId,
                                rule.id ?? ""
                              )
                            }
                          )
                        }
                      />
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </ReactTable>
        </CardContent>
      </Card>
    </VStack>
  );
};

export default CustomerWarranties;
