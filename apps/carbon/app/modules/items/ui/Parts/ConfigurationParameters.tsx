import {
  Array as ArrayInput,
  Hidden,
  Input,
  Select,
  Submit,
  ValidatedForm,
} from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ClientOnly,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";
import {
  useFetcher,
  useFetchers,
  useParams,
  useSubmit,
} from "@remix-run/react";
import { cva } from "class-variance-authority";
import { useEffect, useRef, useState } from "react";
import {
  LuGripVertical,
  LuHash,
  LuKeySquare,
  LuList,
  LuMoreVertical,
  LuPlusCircle,
  LuToggleLeft,
  LuType,
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import type { ConfigurationParameter } from "~/modules/items";
import {
  configurationParameterDataTypes,
  configurationParameterValidator,
} from "~/modules/items";
import type { action as configurationParameterAction } from "~/routes/x+/part+/$itemId.parameter";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";

import { formatRelativeTime } from "@carbon/utils";
import type {
  Active,
  DataRef,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DroppableContainer,
  KeyboardCoordinateGetter,
  Over,
} from "@dnd-kit/core";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  getFirstCollision,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createPortal } from "react-dom";
import { ConfirmDelete } from "~/components/Modals";

function useConfigurationParameters(parameter?: ConfigurationParameter) {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");
  const [key, setKey] = useState(parameter?.key ?? "");
  const [isList, setIsList] = useState(parameter?.dataType === "list");

  const onChangeCheckForListType = (
    newValue: {
      value: string;
      label: string | JSX.Element;
    } | null
  ) => {
    if (!newValue) return;
    const type = newValue.value;
    setIsList(type === "list");
  };

  const updateKey = (e: React.ChangeEvent<HTMLInputElement>) => {
    const label = e.target.value;
    setKey(label.toLowerCase().replace(/ /g, "_"));
  };

  return {
    key,
    isList,
    itemId,
    onChangeCheckForListType,
    setKey,
    setIsList,
    updateKey,
  };
}

type ConfigurationParameterGroup = {
  id: string;
  name: string;
};

export default function ConfigurationParametersForm({
  parameters: initialParameters,
}: {
  parameters: ConfigurationParameter[];
}) {
  const {
    isList,
    itemId,
    key,
    onChangeCheckForListType,
    setKey,
    setIsList,
    updateKey,
  } = useConfigurationParameters();

  const submit = useSubmit();
  const fetcher = useFetcher<typeof configurationParameterAction>();

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error("Failed to update configuration parameter");
    }
  }, [fetcher.data]);

  // Dummy groups for now - will be replaced with real data later
  const [groups] = useState<ConfigurationParameterGroup[]>([
    { id: "null", name: "Ungrouped" },
    { id: "group1", name: "Group 1" },
    { id: "group2", name: "Group 2" },
  ]);

  const [groupOrder, setGroupOrder] = useState<string[]>(() => {
    return groups.map((group) => group.id);
  });

  const parametersById = new Map<string, ConfigurationParameter>(
    initialParameters.map((parameter) => [parameter.id, parameter])
  );

  const pendingParameters = usePendingParameters({ itemId });

  // merge pending parameters and existing parameters
  for (let pendingParameter of pendingParameters) {
    let parameter = parametersById.get(pendingParameter.id);
    if (parameter) {
      parametersById.set(pendingParameter.id, {
        ...parameter,
        ...pendingParameter,
      });
    }
  }

  const parameters = Array.from(parametersById.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

  const [activeParameter, setActiveParameter] =
    useState<ConfigurationParameter | null>(null);
  const [activeGroup, setActiveGroup] =
    useState<ConfigurationParameterGroup | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter,
    })
  );

  return (
    <Card isCollapsible>
      <CardHeader>
        <CardTitle>Parameters</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="p-6 border rounded-lg">
            <ValidatedForm
              action={path.to.configurationParameter(itemId)}
              method="post"
              validator={configurationParameterValidator}
              fetcher={fetcher}
              resetAfterSubmit
              onSubmit={() => {
                setKey("");
                setIsList(false);
              }}
              defaultValues={{
                itemId: itemId,
                key: "",
                label: "",
                dataType: "numeric",
                listOptions: [],
                configurationParameterGroupId: undefined,
              }}
              className="w-full"
            >
              <Hidden name="id" />
              <Hidden name="itemId" />
              <Hidden name="key" value={key} />
              <VStack spacing={4}>
                <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                  <VStack>
                    <Input name="label" label="Label" onChange={updateKey} />
                    {key && (
                      <HStack spacing={1}>
                        <LuKeySquare className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {key}
                        </span>
                      </HStack>
                    )}
                  </VStack>

                  <Select
                    name="dataType"
                    label="Data Type"
                    options={configurationParameterDataTypes.map((type) => ({
                      label: (
                        <HStack className="w-full">
                          <ConfigurationParameterDataTypeIcon
                            type={type}
                            className="mr-2"
                          />
                          {capitalize(type)}
                        </HStack>
                      ),
                      value: type,
                    }))}
                    onChange={onChangeCheckForListType}
                  />
                  {isList && (
                    <ArrayInput name="listOptions" label="List Parameters" />
                  )}
                </div>

                <Submit
                  leftIcon={<LuPlusCircle />}
                  isDisabled={fetcher.state !== "idle"}
                  isLoading={fetcher.state !== "idle"}
                >
                  Add Parameter
                </Submit>
              </VStack>
            </ValidatedForm>
          </div>

          {parameters.length > 0 && (
            <DndContext
              sensors={sensors}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOver={onDragOver}
            >
              <SortableContext items={groupOrder}>
                <div className="relative"></div>
                {groups.map((group) => {
                  const groupParameters = parameters.filter(
                    (opt) => `${opt.configurationParameterGroupId}` === group.id
                  );

                  return (
                    <div
                      key={group.id}
                      className={cn(
                        "transition-opacity",
                        activeGroup?.id === group.id && "opacity-0"
                      )}
                    >
                      <ParameterGroup
                        group={group}
                        parameters={groupParameters}
                      />
                    </div>
                  );
                })}
              </SortableContext>
              <ClientOnly fallback={null}>
                {() =>
                  createPortal(
                    <DragOverlay>
                      {activeGroup && (
                        <ParameterGroup
                          group={activeGroup}
                          parameters={parameters.filter(
                            (opt) =>
                              `${opt.configurationParameterGroupId}` ===
                              activeGroup.id
                          )}
                        />
                      )}
                      {activeParameter && (
                        <ConfigurableParameter
                          parameter={activeParameter}
                          isOverlay
                        />
                      )}
                    </DragOverlay>,
                    document.body
                  )
                }
              </ClientOnly>
            </DndContext>
          )}
        </div>
      </CardContent>
    </Card>
  );

  function onDragStart(event: DragStartEvent) {
    console.log("onDragStart", event);
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;
    if (data?.type === "group") {
      setActiveGroup(data.group);
      return;
    }

    if (data?.type === "parameter") {
      setActiveParameter(data.parameter);
      return;
    }
  }

  function onDragEnd(event: DragEndEvent) {
    console.log("onDragEnd", event);
    setActiveGroup(null);
    setActiveParameter(null);

    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (!hasDraggableData(active)) return;

    const activeData = active.data.current;

    if (activeId === overId) return;

    const isActiveAColumn = activeData?.type === "group";
    if (!isActiveAColumn) return;

    setGroupOrder((prevOrder) => {
      const activeColumnIndex = prevOrder.findIndex((id) => id === activeId);
      const overGroupIndex = prevOrder.findIndex((id) => id === overId);

      return arrayMove(prevOrder, activeColumnIndex, overGroupIndex);
    });
  }

  function onDragOver(event: DragOverEvent) {
    console.log("onDragOver", event);
    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    if (!hasDraggableData(active) || !hasDraggableData(over)) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    const overGroup =
      overData?.type === "parameter"
        ? groups.find(
            (group) =>
              group.id === `${overData.parameter.configurationParameterGroupId}`
          )
        : overData?.group;

    const isActiveAnParameter = activeData?.type === "parameter";
    const isOverAnParameter = overData?.type === "parameter";

    const activeParameter = parametersById.get(activeId.toString());
    const overParameter = parametersById.get(overId.toString());

    if (!isActiveAnParameter) return;

    // Im dropping a Item over another Item
    if (
      isActiveAnParameter &&
      isOverAnParameter &&
      activeParameter &&
      overParameter
    ) {
      let sortOrderBefore = 0;
      let sortOrderAfter = 0;
      if (
        activeParameter.sortOrder > overParameter.sortOrder ||
        activeParameter.configurationParameterGroupId !==
          overParameter.configurationParameterGroupId
      ) {
        sortOrderAfter = overParameter.sortOrder;

        for (let i = parameters.length - 1; i >= 0; i--) {
          const parameter = parameters[i];
          if (
            `${parameter.configurationParameterGroupId}` ===
              `${overParameter.configurationParameterGroupId}` &&
            parameter.sortOrder < sortOrderAfter
          ) {
            sortOrderBefore = parameter.sortOrder ?? 0;
            break;
          }
        }
      } else {
        sortOrderBefore = overParameter.sortOrder;
        sortOrderAfter =
          parameters.find(
            (parameter) =>
              `${parameter.configurationParameterGroupId}` ===
                `${overParameter.configurationParameterGroupId}` &&
              parameter.sortOrder > sortOrderBefore
          )?.sortOrder ?? sortOrderBefore + 1;
      }

      const newSortOrder = (sortOrderBefore + sortOrderAfter) / 2;

      if (
        activeParameter.configurationParameterGroupId !==
        overParameter.configurationParameterGroupId
      ) {
        submit(
          {
            id: activeParameter.id,
            configurationParameterGroupId:
              overParameter.configurationParameterGroupId == "null"
                ? null
                : overParameter.configurationParameterGroupId,
            sortOrder: newSortOrder,
          },
          {
            method: "post",
            action: path.to.configurationParameterOrder(activeParameter.itemId),
            navigate: false,
            fetcherKey: `parameter:${activeParameter.id}`,
          }
        );
        return;
      }

      if (activeParameter && overParameter) {
        submit(
          {
            id: activeParameter.id,
            configurationParameterGroupId:
              overParameter.configurationParameterGroupId == "null"
                ? null
                : overParameter.configurationParameterGroupId,
            sortOrder: newSortOrder,
          },
          {
            method: "post",
            action: path.to.configurationParameterOrder(activeParameter.itemId),
            navigate: false,
            fetcherKey: `parameter:${activeParameter.id}`,
          }
        );
      }
      return;
    }

    const isOverAGroup = overData?.type === "group";

    // Im dropping a Item over a column
    if (isActiveAnParameter && isOverAGroup) {
      const activeParameter = parametersById.get(activeId.toString());
      const groupId = overId as string;

      if (activeParameter) {
        const firstItemInColumn = parameters.find(
          (parameter) => parameter.configurationParameterGroupId === groupId
        );
        const sortOrderBefore = 0;
        const sortOrderAfter = firstItemInColumn?.sortOrder ?? 1;

        const newSortOrder = (sortOrderBefore + sortOrderAfter) / 2;

        submit(
          {
            id: activeParameter.id,
            configurationParameterGroupId: groupId == "null" ? null : groupId,
            sortOrder: newSortOrder,
          },
          {
            method: "post",
            action: path.to.configurationParameter(activeParameter.itemId),
            navigate: false,
            fetcherKey: `parameter:${activeParameter.id}`,
          }
        );
      }
    }
  }
}

function ParameterGroup({
  group,
  parameters,
  isOverlay,
}: {
  group: ConfigurationParameterGroup;
  parameters: ConfigurationParameter[];
  isOverlay?: boolean;
}) {
  const parametersIds = parameters.map((parameter) => parameter.id);
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.id,
    data: { type: "group", group } satisfies GroupData,
    attributes: {
      roleDescription: `Group: ${group.name}`,
    },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const variants = cva("border rounded-lg", {
    variants: {
      dragging: {
        default: "",
        over: "ring-2 opacity-30",
        overlay: "ring-2 ring-primary",
      },
    },
  });

  return (
    <div
      key={group.id}
      ref={setNodeRef}
      style={style}
      className={variants({
        dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
      })}
    >
      <div className="p-4 border-b bg-muted/30">
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Reorder Group"
              icon={<LuGripVertical />}
              variant="ghost"
              {...attributes}
              {...listeners}
              className="cursor-grab"
            />
            <h3 className="font-semibold">{group.name}</h3>
          </HStack>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label="Open menu"
                icon={<LuMoreVertical />}
                variant="ghost"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Edit</DropdownMenuItem>
              <DropdownMenuItem destructive>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </div>
      <SortableContext items={parameters.map((opt) => opt.id)}>
        <div className="p-2 flex flex-col gap-2">
          {parameters.map((parameter) => (
            <ConfigurableParameter key={parameter.id} parameter={parameter} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function ConfigurableParameter({
  parameter,
  className,
  isOverlay,
}: {
  parameter: ConfigurationParameter;
  className?: string;
  isOverlay?: boolean;
}) {
  const { isList, key, onChangeCheckForListType, updateKey } =
    useConfigurationParameters(parameter);

  const disclosure = useDisclosure();
  const deleteModalDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof configurationParameterAction>();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: parameter.id,
    data: {
      type: "parameter",
      parameter,
    } satisfies ParameterData,
    attributes: {
      roleDescription: `Parameter: ${parameter.label}`,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle") {
      disclosure.onClose();
      submitted.current = false;
    }
  }, [fetcher.state]);

  const isUpdated = parameter.updatedBy !== null;
  const person = isUpdated ? parameter.updatedBy : parameter.createdBy;
  const date = parameter.updatedAt ?? parameter.createdAt;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border rounded-lg p-4 bg-card",
        isDragging && "opacity-50",
        isOverlay && "shadow-lg",
        className
      )}
    >
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.configurationParameter(parameter.itemId)}
          method="post"
          validator={configurationParameterValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            id: parameter.id,
            itemId: parameter.itemId,
            key: parameter.key,
            label: parameter.label,
            dataType: parameter.dataType,
            listOptions: parameter.listOptions ?? [],
          }}
        >
          <Hidden name="id" />
          <Hidden name="itemId" />
          <Hidden name="key" value={key} />
          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <VStack>
                <Input
                  name="label"
                  label="Label"
                  onChange={updateKey}
                  autoFocus
                />
                {key && (
                  <HStack spacing={1}>
                    <LuKeySquare className="w-3 h-3 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{key}</span>
                  </HStack>
                )}
              </VStack>

              <Select
                name="dataType"
                label="Data Type"
                options={configurationParameterDataTypes.map((type) => ({
                  label: (
                    <HStack className="w-full">
                      <ConfigurationParameterDataTypeIcon
                        type={type}
                        className="mr-2"
                      />
                      {capitalize(type)}
                    </HStack>
                  ),
                  value: type,
                }))}
                onChange={onChangeCheckForListType}
              />
              {isList && (
                <ArrayInput name="listOptions" label="List Parameters" />
              )}
            </div>
            <HStack className="w-full justify-end" spacing={2}>
              <Button variant="secondary" onClick={disclosure.onClose}>
                Cancel
              </Button>
              <Submit
                isDisabled={fetcher.state !== "idle"}
                isLoading={fetcher.state !== "idle"}
              >
                Save
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      ) : (
        <div className="flex flex-1 justify-between items-center w-full">
          <HStack spacing={2} className="w-1/2">
            <IconButton
              aria-label="Reorder"
              icon={<LuGripVertical />}
              variant="ghost"
              {...attributes}
              {...listeners}
              className="cursor-grab"
            />
            <HStack spacing={4} className="flex-1">
              <div className="bg-muted border rounded-full flex items-center justify-center p-2">
                <ConfigurationParameterDataTypeIcon
                  type={parameter.dataType}
                  className="w-4 h-4"
                />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">{parameter.label}</span>
                <span className="text-xs text-muted-foreground">
                  {parameter.key}
                </span>
              </VStack>
            </HStack>
          </HStack>
          <div className="flex items-center justify-end gap-2">
            <HStack spacing={2}>
              <span className="text-xs text-muted-foreground">
                {isUpdated ? "Updated" : "Created"} {formatRelativeTime(date)}
              </span>
              <EmployeeAvatar employeeId={person} withName={false} />
            </HStack>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="Open menu"
                  icon={<LuMoreVertical />}
                  variant="ghost"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={disclosure.onOpen}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onClick={deleteModalDisclosure.onOpen}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {deleteModalDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteConfigurationParameter(
            parameter.itemId,
            parameter.id
          )}
          isOpen={deleteModalDisclosure.isOpen}
          name={parameter.label}
          text={`Are you sure you want to delete the ${parameter.label} parameter? This will not update any formulas that are using this parameter.`}
          onCancel={() => {
            deleteModalDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteModalDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

function ConfigurationParameterDataTypeIcon({
  type,
  className,
}: {
  type: (typeof configurationParameterDataTypes)[number];
  className?: string;
}) {
  switch (type) {
    case "numeric":
      return <LuHash className={cn("w-4 h-4 text-blue-600", className)} />;
    case "text":
      return <LuType className={cn("w-4 h-4 text-green-600", className)} />;
    case "boolean":
      return (
        <LuToggleLeft className={cn("w-4 h-4 text-purple-600", className)} />
      );
    case "list":
      return <LuList className={cn("w-4 h-4 text-orange-600", className)} />;
    default:
      return null;
  }
}

function usePendingParameters({ itemId }: { itemId: string }) {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.configurationParameter(itemId);
    })
    .map((fetcher) => {
      let configurationParameterGroupId = String(
        fetcher.formData.get("configurationParameterGroupId")
      );
      let id = String(fetcher.formData.get("id"));
      let label = String(fetcher.formData.get("label"));
      let key = String(fetcher.formData.get("key"));
      let dataType = String(
        fetcher.formData.get("dataType")
      ) as ConfigurationParameter["dataType"];

      let item: {
        id: string;
        label: string;
        key: string;
        dataType: ConfigurationParameter["dataType"];
        configurationParameterGroupId: string;
      } = {
        id,
        label,
        key,
        dataType,
        configurationParameterGroupId,
      };
      return item;
    });
}

const directions: string[] = [
  KeyboardCode.Down,
  KeyboardCode.Right,
  KeyboardCode.Up,
  KeyboardCode.Left,
];

export const coordinateGetter: KeyboardCoordinateGetter = (
  event,
  { context: { active, droppableRects, droppableContainers, collisionRect } }
) => {
  if (directions.includes(event.code)) {
    event.preventDefault();

    if (!active || !collisionRect) {
      return;
    }

    const filteredContainers: DroppableContainer[] = [];

    droppableContainers.getEnabled().forEach((entry) => {
      if (!entry || entry?.disabled) {
        return;
      }

      const rect = droppableRects.get(entry.id);

      if (!rect) {
        return;
      }

      const data = entry.data.current;

      if (data) {
        const { type, children } = data;

        if (type === "Group" && children?.length > 0) {
          if (active.data.current?.type !== "Group") {
            return;
          }
        }
      }

      switch (event.code) {
        case KeyboardCode.Down:
          if (active.data.current?.type === "Group") {
            return;
          }
          if (collisionRect.top < rect.top) {
            // find all droppable areas below
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Up:
          if (active.data.current?.type === "Group") {
            return;
          }
          if (collisionRect.top > rect.top) {
            // find all droppable areas above
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Left:
          if (collisionRect.left >= rect.left + rect.width) {
            // find all droppable areas to left
            filteredContainers.push(entry);
          }
          break;
        case KeyboardCode.Right:
          // find all droppable areas to right
          if (collisionRect.left + collisionRect.width <= rect.left) {
            filteredContainers.push(entry);
          }
          break;
      }
    });
    const collisions = closestCorners({
      active,
      collisionRect: collisionRect,
      droppableRects,
      droppableContainers: filteredContainers,
      pointerCoordinates: null,
    });
    const closestId = getFirstCollision(collisions, "id");

    if (closestId != null) {
      const newDroppable = droppableContainers.get(closestId);
      const newNode = newDroppable?.node.current;
      const newRect = newDroppable?.rect.current;

      if (newNode && newRect) {
        return {
          x: newRect.left,
          y: newRect.top,
        };
      }
    }
  }

  return undefined;
};

type GroupData = {
  type: "group";
  group: ConfigurationParameterGroup;
};

type ParameterData = {
  type: "parameter";
  parameter: ConfigurationParameter;
};

export type DraggableData = GroupData | ParameterData;

export function hasDraggableData<T extends Active | Over>(
  entry: T | null | undefined
): entry is T & {
  data: DataRef<DraggableData>;
} {
  if (!entry) {
    return false;
  }

  const data = entry.data.current;

  if (data?.type === "parameter" || data?.type === "group") {
    return true;
  }

  return false;
}
