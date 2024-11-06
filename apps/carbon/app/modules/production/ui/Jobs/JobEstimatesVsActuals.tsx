import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  IconButton,
  Switch,
  Table,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  useDisclosure,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import type { z } from "zod";
import { OperationStatusIcon, TimeTypeIcon } from "~/components/Icons";

import { formatDurationMilliseconds } from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned,
} from "@internationalized/date";
import { LuExternalLink } from "react-icons/lu";
import { usePercentFormatter } from "~/hooks";
import { makeDurations } from "~/utils/duration";
import { path } from "~/utils/path";
import type { jobOperationValidator } from "../../production.models";
import type {
  JobOperation,
  ProductionEvent,
  ProductionQuantity,
} from "../../types";

type Operation = z.infer<typeof jobOperationValidator> & {
  status: JobOperation["status"];
  operationQuantity: number | null;
};

const timeTypes = ["Setup", "Labor", "Machine"] as const;

const JobEstimatesVsActuals = ({
  operations,
  productionEvents,
  productionQuantities,
}: {
  operations: Operation[];
  productionEvents: ProductionEvent[];
  productionQuantities: ProductionQuantity[];
}) => {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Could not find jobId");

  const percentFormatter = usePercentFormatter();
  const detailsDisclosure = useDisclosure();

  const getEstimatedTime = (operation: Operation) => {
    const op = makeDurations(operation);

    return {
      total: op.duration,
      setup: op.setupDuration,
      labor: op.laborDuration,
      machine: op.machineDuration,
    };
  };

  const getActualTime = (operation: Operation) => {
    const operationEvents = productionEvents.filter(
      (pe) => pe.jobOperationId === operation.id
    );
    const timeNow = now(getLocalTimeZone());
    const actualTimes = operationEvents.reduce(
      (acc, event) => {
        if (event.endTime && event.type) {
          acc[event.type.toLowerCase() as keyof typeof acc] +=
            (event.duration ?? 0) * 1000;
        } else if (event.startTime && event.type) {
          const startTime = toZoned(
            parseAbsolute(event.startTime, getLocalTimeZone()),
            getLocalTimeZone()
          );

          const difference = timeNow.compare(startTime);

          if (difference > 0) {
            acc[event.type.toLowerCase() as keyof typeof acc] += difference;
          }
        }
        return acc;
      },
      {
        setup: 0,
        labor: 0,
        machine: 0,
      }
    );

    return {
      total: actualTimes.setup + actualTimes.labor + actualTimes.machine,
      ...actualTimes,
    };
  };

  const getCompleteQuantity = (operation: Operation) => {
    const quantity = productionQuantities
      .filter(
        (pq) => pq.jobOperationId === operation.id && pq.type === "Production"
      )
      .reduce((acc, pq) => acc + pq.quantity, 0);
    return quantity ?? 0;
  };

  const getScrapQuantity = (operation: Operation) => {
    const quantity = productionQuantities
      .filter((pq) => pq.jobOperationId === operation.id && pq.type === "Scrap")
      .reduce((acc, pq) => acc + pq.quantity, 0);
    return quantity ?? 0;
  };

  return (
    <Card>
      <HStack className="justify-between items-start">
        <CardHeader>
          <CardTitle>Estimates vs Actual</CardTitle>
        </CardHeader>
        <CardAction>
          <div className="flex items-center space-x-2 py-2">
            <Switch
              variant="small"
              checked={detailsDisclosure.isOpen}
              onCheckedChange={detailsDisclosure.onToggle}
              id="cost-details"
            />
            <label className="text-sm" htmlFor="cost-details">
              Show Details
            </label>
          </div>
        </CardAction>
      </HStack>
      <CardContent>
        <Table>
          <Thead>
            <Tr>
              <Th />
              <Th>Estimated</Th>
              <Th>Actual</Th>
              <Th>%</Th>
              <Th>Complete</Th>
              <Th>Scrap</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {operations.map((operation) => {
              const estimated = getEstimatedTime(operation);
              const actual = getActualTime(operation);
              return (
                <>
                  <Tr key={operation.id} className="border-b border-border">
                    <Td className="border-r border-border min-w-[200px]">
                      <HStack className="w-full justify-between ">
                        <span>{operation.description}</span>
                        <Tooltip>
                          <TooltipTrigger>
                            <OperationStatusIcon status={operation.status} />
                          </TooltipTrigger>
                          <TooltipContent>{operation.status}</TooltipContent>
                        </Tooltip>
                      </HStack>
                    </Td>
                    <Td>
                      <span className="line-clamp-1">
                        {formatDurationMilliseconds(estimated.total)}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          "line-clamp-1",
                          actual.total > estimated.total && "text-red-500"
                        )}
                      >
                        {formatDurationMilliseconds(actual.total)}
                      </span>
                    </Td>
                    <Td>
                      <span
                        className={cn(
                          "line-clamp-1",
                          actual.total > estimated.total && "text-red-500"
                        )}
                      >
                        {percentFormatter.format(
                          actual.total / estimated.total
                        )}
                      </span>
                    </Td>
                    <Td>{`${getCompleteQuantity(operation)}/${
                      operation.operationQuantity
                    }`}</Td>
                    <Td>{getScrapQuantity(operation)}</Td>
                    <Td>
                      <Link
                        to={`${path.to.jobProductionEvents(
                          jobId
                        )}?filter=jobOperationId:eq:${operation.id}`}
                      >
                        <IconButton
                          variant="ghost"
                          icon={<LuExternalLink />}
                          aria-label="View Production Events"
                        />
                      </Link>
                    </Td>
                  </Tr>
                  {detailsDisclosure.isOpen && (
                    <>
                      {timeTypes.map((type) => {
                        if (
                          estimated[
                            type.toLowerCase() as keyof typeof estimated
                          ] === 0
                        ) {
                          return null;
                        }
                        return (
                          <Tr key={type} className="border-b border-border">
                            <Td className="border-r border-border pl-10">
                              <HStack>
                                <TimeTypeIcon type={type} />
                                <span>{type}</span>
                              </HStack>
                            </Td>
                            <Td>
                              {formatDurationMilliseconds(
                                estimated[
                                  type.toLowerCase() as keyof typeof estimated
                                ]
                              )}
                            </Td>
                            <Td>
                              {formatDurationMilliseconds(
                                actual[
                                  type.toLowerCase() as keyof typeof actual
                                ]
                              )}
                            </Td>
                            <Td>
                              {percentFormatter.format(
                                actual[
                                  type.toLowerCase() as keyof typeof actual
                                ] /
                                  estimated[
                                    type.toLowerCase() as keyof typeof estimated
                                  ]
                              )}
                            </Td>
                            <Td />
                            <Td />
                            <Td>
                              <Link
                                to={`${path.to.jobProductionEvents(
                                  jobId
                                )}?filter=jobOperationId:eq:${
                                  operation.id
                                }&filter=type:eq:${type}`}
                              >
                                <IconButton
                                  variant="ghost"
                                  icon={<LuExternalLink />}
                                  aria-label="View Production Events"
                                />
                              </Link>
                            </Td>
                          </Tr>
                        );
                      })}
                    </>
                  )}
                </>
              );
            })}
          </Tbody>
          <Tfoot>
            {/* <Tr className="font-bold">
              <Td className="border-r border-border" />
              {types.map((type) => (
                <Td key={type}>
                  <Button variant="secondary">Add</Button>
                </Td>
              ))}
            </Tr> */}
          </Tfoot>
        </Table>
      </CardContent>
    </Card>
  );
};

export default JobEstimatesVsActuals;
