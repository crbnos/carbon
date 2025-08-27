import type { Database } from "@carbon/database";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Switch,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Tfoot,
  Th,
  Thead,
  toast,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { Link, useParams } from "@remix-run/react";
import type { z } from "zod";
import { MethodIcon, TimeTypeIcon } from "~/components/Icons";

import { useCarbon } from "@carbon/auth";
import { formatDurationMilliseconds, getItemReadableId } from "@carbon/utils";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned,
} from "@internationalized/date";
import { useEffect, useState } from "react";
import { LuCircleChevronRight, LuNotebook } from "react-icons/lu";
import { EmployeeAvatar, EmployeeAvatarGroup } from "~/components";
import { useCurrencyFormatter, usePercentFormatter, useUser } from "~/hooks";
import { useItems } from "~/stores";
import { makeDurations } from "~/utils/duration";
import { path } from "~/utils/path";
import type { jobOperationValidator } from "../../production.models";
import type { getJobMaterialsByMethodId } from "../../production.service";
import type {
  JobOperation,
  ProductionEvent,
  ProductionQuantity,
} from "../../types";
import { JobOperationStatus } from "./JobOperationStatus";

type Operation = z.infer<typeof jobOperationValidator> & {
  status: JobOperation["status"];
  operationQuantity: number | null;
};

type JobMaterial = NonNullable<
  Awaited<ReturnType<typeof getJobMaterialsByMethodId>>["data"]
>[number];

type Material = Pick<
  JobMaterial,
  | "id"
  | "itemId"
  | "estimatedQuantity"
  | "methodType"
  | "quantityIssued"
  | "quantityToIssue"
  | "unitCost"
>;

const timeTypes = ["Setup", "Labor", "Machine"] as const;

const JobEstimatesVsActuals = ({
  operations,
  materials,
  productionEvents,
  productionQuantities,
  notes,
}: {
  operations: Operation[];
  materials: Material[];
  productionEvents: ProductionEvent[];
  productionQuantities: ProductionQuantity[];
  notes: Database["public"]["Tables"]["jobOperationNote"]["Row"][];
}) => {
  const { carbon } = useCarbon();
  const { jobId } = useParams();
  const user = useUser();
  if (!jobId) throw new Error("Could not find jobId");

  const [items] = useItems();
  const currencyFormatter = useCurrencyFormatter();
  const percentFormatter = usePercentFormatter();
  const detailsDisclosure = useDisclosure();

  const [currentUnitCosts, setCurrentUnitCosts] = useState<
    Record<string, number>
  >({});
  const getCurrentUnitCosts = async (itemIds: string[]) => {
    if (!carbon) return;
    const itemCosts = await carbon
      ?.from("itemCost")
      .select("itemId, unitCost")
      .in("itemId", itemIds);

    if (!itemCosts?.data) {
      toast.error("Failed to fetch item costs");
      return;
    }

    setCurrentUnitCosts(
      itemCosts?.data?.reduce((acc, itemCost) => {
        acc[itemCost.itemId] = itemCost.unitCost;
        return acc;
      }, {} as Record<string, number>)
    );
  };

  useEffect(() => {
    getCurrentUnitCosts(materials.map((m) => m.itemId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials]);

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

  const getEmployeeIds = (
    operation: Operation,
    type: "Setup" | "Labor" | "Machine"
  ) => {
    const operationEvents = productionEvents.filter(
      (pe) => pe.jobOperationId === operation.id && pe.type === type
    );
    const employeeIds = operationEvents.reduce((acc, pe) => {
      if (pe.employeeId) {
        acc.add(pe.employeeId);
      }
      return acc;
    }, new Set<string>());
    return Array.from(employeeIds);
  };

  const getJobOperationNotes = (operation: Operation) => {
    return notes.filter((n) => n.jobOperationId === operation.id);
  };

  const getNotes = (
    operation: Operation,
    type?: "Setup" | "Labor" | "Machine"
  ) => {
    const eventNotes = productionEvents
      .filter(
        (pe) =>
          pe.jobOperationId === operation.id &&
          (type === undefined || pe.type === type)
      )
      .map((pe) => ({
        employeeId: pe.employeeId,
        notes: pe.notes,
        createdAt: pe.createdAt,
        productionEventId: pe.id,
      }));

    const quantityNotes = productionQuantities
      .filter((pq) => pq.jobOperationId === operation.id && type === undefined)
      .map((pq) => ({
        employeeId: pq.createdBy,
        notes: pq.notes,
        createdAt: pq.createdAt,
        productionEventId:
          pq.setupProductionEventId ??
          pq.laborProductionEventId ??
          pq.machineProductionEventId,
      }));

    const notes = [...eventNotes, ...quantityNotes].filter((n) => n.notes);
    if (notes.length === 0) return null;
    return notes;
  };

  return (
    <Tabs defaultValue="processes" className="w-full">
      <Card>
        <HStack className="justify-between items-start">
          <CardHeader>
            <CardTitle>Estimates vs Actual</CardTitle>
            <CardDescription>
              <div className="flex items-center gap-2">
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
            </CardDescription>
          </CardHeader>
          <CardAction>
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="processes">Processes</TabsTrigger>
              <TabsTrigger value="materials">Material</TabsTrigger>
            </TabsList>
          </CardAction>
        </HStack>
        <CardContent>
          <TabsContent value="processes">
            <Table>
              <Thead>
                <Tr>
                  <Th className="px-2" />
                  <Th className="px-2">Estimated</Th>
                  <Th className="px-2">Actual</Th>
                  <Th className="px-2">%</Th>
                  <Th className="px-2">Complete</Th>
                  <Th className="px-2">Scrap</Th>
                  <Th className="px-2" />
                </Tr>
              </Thead>
              <Tbody>
                {operations.map((operation) => {
                  const estimated = getEstimatedTime(operation);
                  const actual = getActualTime(operation);
                  const notes = getJobOperationNotes(operation);

                  const isOutside = operation.operationType === "Outside";
                  if (isOutside) return null;

                  return (
                    <>
                      <Tr key={operation.id} className="border-b border-border">
                        <Td className="border-r border-border px-2">
                          <HStack className="w-full justify-between ">
                            <span>{operation.description}</span>
                            <JobOperationStatus operation={operation} />
                          </HStack>
                        </Td>
                        <Td className="px-2">
                          <span className="flex-shrink-0">
                            {formatDurationMilliseconds(estimated.total)}
                          </span>
                        </Td>
                        <Td className="px-2">
                          <span
                            className={cn(
                              "flex-shrink-0",
                              actual.total > estimated.total && "text-red-500"
                            )}
                          >
                            {formatDurationMilliseconds(actual.total)}
                          </span>
                        </Td>
                        <Td className="px-2">
                          <span
                            className={cn(
                              "line-clamp-1",
                              actual.total > estimated.total && "text-red-500"
                            )}
                          >
                            {estimated.total
                              ? percentFormatter.format(
                                  actual.total / estimated.total
                                )
                              : null}
                          </span>
                        </Td>
                        <Td className="px-2">
                          {`${getCompleteQuantity(operation)}/${
                            operation.operationQuantity
                          }`}
                        </Td>
                        <Td className="px-2">{getScrapQuantity(operation)}</Td>
                        <Td className="px-2">
                          <HStack spacing={0} className="justify-end">
                            {notes && notes.length > 0 && (
                              <Popover>
                                <PopoverTrigger asChild>
                                  <IconButton
                                    variant="ghost"
                                    icon={<LuNotebook />}
                                    aria-label="Notes"
                                  />
                                </PopoverTrigger>
                                <PopoverContent className="w-96 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-gray-300">
                                  <div className="flex flex-col gap-3 p-2">
                                    {notes.map((note, index) => (
                                      <div
                                        key={index}
                                        className="flex gap-2 items-center"
                                      >
                                        <div className="flex-shrink-0">
                                          <EmployeeAvatar
                                            employeeId={note.createdBy}
                                            size="sm"
                                            withName={false}
                                          />
                                        </div>
                                        <div
                                          className={cn(
                                            "flex-1 rounded-lg p-2 text-sm",
                                            note.createdBy === user.id
                                              ? "bg-blue-500 text-white"
                                              : "bg-muted"
                                          )}
                                        >
                                          {note.note}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            )}
                            <Link
                              to={`${path.to.jobProductionEvents(
                                jobId
                              )}?filter=jobOperationId:eq:${operation.id}`}
                            >
                              <IconButton
                                variant="ghost"
                                icon={<LuCircleChevronRight />}
                                aria-label="View Production Events"
                              />
                            </Link>
                          </HStack>
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
                            const employeeIds = getEmployeeIds(operation, type);
                            const notes = getNotes(operation, type);
                            return (
                              <Tr key={type} className="border-b border-border">
                                <Td className="border-r border-border pl-10">
                                  <HStack className="justify-between w-full">
                                    <HStack>
                                      <TimeTypeIcon type={type} />
                                      <span>{type}</span>
                                    </HStack>
                                    {employeeIds.length > 0 && (
                                      <EmployeeAvatarGroup
                                        employeeIds={employeeIds}
                                        size="xs"
                                        limit={3}
                                      />
                                    )}
                                  </HStack>
                                </Td>
                                <Td className="px-2">
                                  {formatDurationMilliseconds(
                                    estimated[
                                      type.toLowerCase() as keyof typeof estimated
                                    ]
                                  )}
                                </Td>
                                <Td className="px-2">
                                  {formatDurationMilliseconds(
                                    actual[
                                      type.toLowerCase() as keyof typeof actual
                                    ]
                                  )}
                                </Td>
                                <Td className="px-2">
                                  {percentFormatter.format(
                                    actual[
                                      type.toLowerCase() as keyof typeof actual
                                    ] /
                                      estimated[
                                        type.toLowerCase() as keyof typeof estimated
                                      ]
                                  )}
                                </Td>
                                <Td className="px-2" />
                                <Td className="px-2" />
                                <Td className="px-2">
                                  <HStack spacing={0} className="justify-end">
                                    {notes && notes.length > 0 && (
                                      <Popover>
                                        <PopoverTrigger asChild>
                                          <IconButton
                                            variant="ghost"
                                            icon={<LuNotebook />}
                                            aria-label="Notes"
                                          />
                                        </PopoverTrigger>
                                        <PopoverContent className="w-96 max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded-full scrollbar-thumb-gray-300">
                                          <div className="flex flex-col gap-3 p-2">
                                            {notes.map((note, index) => (
                                              <div
                                                key={index}
                                                className="flex gap-2 items-center"
                                              >
                                                <div className="flex-shrink-0">
                                                  <EmployeeAvatar
                                                    employeeId={note.employeeId}
                                                    size="sm"
                                                    withName={false}
                                                  />
                                                </div>
                                                <div className="flex-1 rounded-lg bg-muted p-2 text-sm">
                                                  {note.notes}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </PopoverContent>
                                      </Popover>
                                    )}
                                    <Link
                                      to={`${path.to.jobProductionEvents(
                                        jobId
                                      )}?filter=jobOperationId:eq:${
                                        operation.id
                                      }&filter=type:eq:${type}`}
                                    >
                                      <IconButton
                                        variant="ghost"
                                        icon={<LuCircleChevronRight />}
                                        aria-label="View Production Events"
                                      />
                                    </Link>
                                  </HStack>
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
          </TabsContent>
          <TabsContent value="materials">
            <Table>
              <Thead>
                <Tr>
                  <Th>Material</Th>
                  <Th>Estimated</Th>
                  <Th>Actual</Th>
                  <Th>%</Th>
                  {detailsDisclosure.isOpen && (
                    <>
                      <Th>Estimated</Th>
                      <Th>Actual</Th>
                    </>
                  )}
                </Tr>
              </Thead>
              <Tbody>
                {materials?.map((material) => {
                  const exceedsEstimate =
                    material.quantityIssued &&
                    material.quantityIssued > (material.estimatedQuantity ?? 0);
                  const currentUnitCost =
                    currentUnitCosts[material.itemId] ?? 0;

                  const estimatedTotalCost =
                    (material.estimatedQuantity ?? 0) *
                    (material.unitCost ?? 0);
                  const actualTotalCost =
                    (material.quantityIssued ?? 0) * currentUnitCost;

                  return (
                    <>
                      <Tr key={material.id} className="border-b border-border">
                        <Td className="border-r border-border">
                          <HStack className="w-full justify-start">
                            <Tooltip>
                              <TooltipTrigger>
                                <MethodIcon type={material.methodType} />
                              </TooltipTrigger>
                              <TooltipContent>
                                {material.methodType}
                              </TooltipContent>
                            </Tooltip>
                            <span>
                              {getItemReadableId(items, material.itemId)}
                            </span>
                          </HStack>
                        </Td>
                        <Td>{material.estimatedQuantity}</Td>
                        <Td className={cn(exceedsEstimate && "text-red-500")}>
                          {material.methodType === "Make" ? (
                            <MethodIcon type="Make" />
                          ) : (
                            material.quantityIssued
                          )}
                        </Td>

                        <Td className={cn(exceedsEstimate && "text-red-500")}>
                          {material.methodType !== "Make" &&
                          material.estimatedQuantity &&
                          material.quantityIssued
                            ? percentFormatter.format(
                                material.quantityIssued /
                                  material.estimatedQuantity
                              )
                            : null}
                        </Td>
                        {detailsDisclosure.isOpen && (
                          <>
                            <Td>
                              {material.methodType === "Make" ? null : (
                                <VStack spacing={0} className="py-1">
                                  <span className="text-sm">
                                    {currencyFormatter.format(
                                      estimatedTotalCost
                                    )}
                                  </span>
                                  <span className="text-xxs">
                                    {currencyFormatter.format(
                                      material.unitCost ?? 0
                                    )}
                                  </span>
                                </VStack>
                              )}
                            </Td>
                            <Td>
                              {material.methodType === "Make" ? null : (
                                <VStack spacing={0} className="py-1">
                                  <span
                                    className={cn(
                                      "text-sm",
                                      actualTotalCost > estimatedTotalCost &&
                                        "text-red-500"
                                    )}
                                  >
                                    {currencyFormatter.format(actualTotalCost)}
                                  </span>
                                  <span
                                    className={cn(
                                      "text-xxs",
                                      currentUnitCost > material.unitCost &&
                                        "text-red-500"
                                    )}
                                  >
                                    {currencyFormatter.format(currentUnitCost)}
                                  </span>
                                </VStack>
                              )}
                            </Td>
                          </>
                        )}
                      </Tr>
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
          </TabsContent>
        </CardContent>
      </Card>
    </Tabs>
  );
};

export default JobEstimatesVsActuals;
