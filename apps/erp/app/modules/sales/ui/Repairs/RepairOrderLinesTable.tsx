import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack,
  Table as ReactTable,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuCheck, LuTrash2 } from "react-icons/lu";
import { useFetcher } from "react-router";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { CustodyStatus } from "./RepairOrderStatus";
import type { RepairOrderLine } from "./types";

/**
 * Coverage, not registration. "In warranty" used to mean only that a
 * registration was attached at intake, so a lapsed unit read as covered right
 * up to the moment it billed itself to Warranty Expense. The classes are shown
 * separately when they disagree, because parts and labor expire on their own
 * clocks and the charge default follows whichever one the charge belongs to.
 */
function WarrantyVerdict({ line }: { line: RepairOrderLine }) {
  if (!line.warrantyRegistrationId) {
    return (
      <span className="text-muted-foreground">
        <Trans>Not registered</Trans>
      </span>
    );
  }

  const { partsInWarranty, laborInWarranty } = line;

  if (partsInWarranty && laborInWarranty) return <Trans>In warranty</Trans>;
  if (partsInWarranty) return <Trans>Parts only</Trans>;
  if (laborInWarranty) return <Trans>Labor only</Trans>;

  return (
    <span className="text-muted-foreground">
      <Trans>Expired</Trans>
    </span>
  );
}

type RepairOrderLinesTableProps = {
  repairOrderId: string;
  status: string;
  lines: RepairOrderLine[];
  warrantyTerms: { id: string; name: string }[];
};

const RepairOrderLinesTable = ({
  repairOrderId,
  status,
  lines,
  warrantyTerms
}: RepairOrderLinesTableProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher();
  const canUpdate = permissions.can("update", "sales");
  const isOpen = !["Completed", "Cancelled"].includes(status);

  const post = (action: string, body: Record<string, string> = {}) =>
    fetcher.submit(body, { method: "post", action });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Units</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ReactTable>
          <Thead>
            <Tr>
              <Th>#</Th>
              <Th>{t`Item`}</Th>
              <Th>{t`Serial / Batch`}</Th>
              <Th>{t`Qty`}</Th>
              <Th>{t`Where`}</Th>
              <Th>{t`Warranty`}</Th>
              <Th>{t`Reason`}</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {lines.length === 0 && (
              <Tr>
                <Td colSpan={8} className="text-muted-foreground text-center">
                  <Trans>No units on this repair order yet</Trans>
                </Td>
              </Tr>
            )}
            {lines.map((line) => {
              const entity = line.repairOrderLineTrackedEntity?.[0];
              return (
                <Tr key={line.id}>
                  <Td>{line.lineNumber}</Td>
                  <Td>
                    <div className="flex flex-col">
                      <span>{line.item?.readableIdWithRevision}</span>
                      <span className="text-xs text-muted-foreground line-clamp-1">
                        {line.item?.name}
                      </span>
                    </div>
                  </Td>
                  <Td>{entity?.trackedEntity?.readableId ?? "—"}</Td>
                  <Td className="tabular-nums">{line.quantity}</Td>
                  <Td>
                    <CustodyStatus status={line.status} />
                  </Td>
                  <Td>
                    <WarrantyVerdict line={line} />
                  </Td>
                  <Td>{line.returnReason?.name ?? "—"}</Td>
                  <Td>
                    <HStack spacing={1}>
                      {/* In-house repair finished: the unit is ready to go home. */}
                      {isOpen && line.status === "Received" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          leftIcon={<LuCheck />}
                          isDisabled={!canUpdate}
                          onClick={() =>
                            post(
                              path.to.repairOrderLineRepaired(
                                repairOrderId,
                                line.id
                              )
                            )
                          }
                        >
                          <Trans>Mark Repaired</Trans>
                        </Button>
                      )}
                      {/* Terminal exit for a unit that cannot be saved. */}
                      {isOpen &&
                        (line.status === "Received" ||
                          line.status === "Repaired") && (
                          <Button
                            size="sm"
                            variant="destructive"
                            leftIcon={<LuTrash2 />}
                            isDisabled={!canUpdate}
                            onClick={() =>
                              post(
                                path.to.repairOrderLineScrap(
                                  repairOrderId,
                                  line.id
                                )
                              )
                            }
                          >
                            <Trans>Scrap Unit</Trans>
                          </Button>
                        )}
                      {/* Applying a repair warranty writes a NEW registration. */}
                      {isOpen &&
                        line.status === "Repaired" &&
                        warrantyTerms.length > 0 && (
                          <select
                            className="text-sm border rounded-md px-2 py-1 bg-background"
                            defaultValue=""
                            disabled={!canUpdate}
                            onChange={(event) => {
                              if (!event.target.value) return;
                              post(
                                path.to.repairOrderApplyWarranty(repairOrderId),
                                {
                                  lineId: line.id,
                                  warrantyTermId: event.target.value
                                }
                              );
                            }}
                          >
                            <option value="">{t`Apply warranty…`}</option>
                            {warrantyTerms.map((term) => (
                              <option key={term.id} value={term.id}>
                                {term.name}
                              </option>
                            ))}
                          </select>
                        )}
                    </HStack>
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </ReactTable>
      </CardContent>
    </Card>
  );
};

export default RepairOrderLinesTable;
