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
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
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
  LuCirclePlus,
  LuEllipsisVertical,
  LuFolderOpen,
  LuGripVertical,
  LuKeySquare,
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import type { ConfigurationParameter } from "~/modules/items";
import {
  configurationParameterDataTypes,
  configurationParameterGroupValidator,
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
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createPortal, flushSync } from "react-dom";
import { ConfiguratorDataTypeIcon } from "~/components/Configurator/Icons";
import { ConfirmDelete } from "~/components/Modals";

type ConfigurationParameterGroup = {
  id: string;
  name: string;
  sortOrder: number;
  isUngrouped: boolean;
};

export default function ConfigurationParametersForm({
  parameters: initialParameters,
  groups: initialGroups,
}: {
  parameters: ConfigurationParameter[];
  groups: ConfigurationParameterGroup[];
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

  const groupDisclosure = useDisclosure();
  const deleteGroupDisclosure = useDisclosure();
  const [selectedGroup, setSelectedGroup] =
    useState<ConfigurationParameterGroup | null>(null);

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

  const groupsById = new Map<string, ConfigurationParameterGroup>(
    initialGroups.map((group) => [group.id, group])
  );

  const pendingGroups = usePendingGroups({ itemId });

  // merge pending groups and existing groups
  for (let pendingGroup of pendingGroups) {
    let group = groupsById.get(pendingGroup.id);
    if (group) {
      groupsById.set(pendingGroup.id, { ...group, ...pendingGroup });
    }
  }

  const groups = Array.from(groupsById.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );

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
    <>
      <Card isCollapsible defaultCollapsed>
        <CardHeader>
          <CardTitle>Configuration Parameters</CardTitle>
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
                            <ConfiguratorDataTypeIcon
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
                  <HStack spacing={2}>
                    <Submit
                      leftIcon={<LuCirclePlus />}
                      isDisabled={fetcher.state !== "idle"}
                      isLoading={
                        fetcher.state !== "idle" &&
                        fetcher.formAction ===
                          path.to.configurationParameter(itemId)
                      }
                    >
                      Add Parameter
                    </Submit>
                  </HStack>
                </VStack>
              </ValidatedForm>
            </div>
            <div className="flex">
              <Button
                type="button"
                variant="secondary"
                leftIcon={<LuFolderOpen />}
                onClick={groupDisclosure.onOpen}
              >
                Add Group
              </Button>
            </div>

            {parameters.length > 0 && (
              <DndContext
                sensors={sensors}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
              >
                <SortableContext items={groups.map((g) => g.id)}>
                  <div className="relative"></div>
                  {groups
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((group) => {
                      const groupParameters = parameters.filter(
                        (opt) =>
                          `${opt.configurationParameterGroupId}` === group.id
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
                            deleteGroupDisclosure={deleteGroupDisclosure}
                            groupDisclosure={groupDisclosure}
                            setSelectedGroup={setSelectedGroup}
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
                            deleteGroupDisclosure={deleteGroupDisclosure}
                            groupDisclosure={groupDisclosure}
                            isOverlay
                            parameters={parameters.filter(
                              (opt) =>
                                `${opt.configurationParameterGroupId}` ===
                                activeGroup.id
                            )}
                            setSelectedGroup={setSelectedGroup}
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
      {deleteGroupDisclosure.isOpen && selectedGroup && (
        <ConfirmDelete
          action={path.to.deleteConfigurationParameterGroup(
            itemId,
            selectedGroup.id
          )}
          isOpen
          name={selectedGroup.name ?? ""}
          text={`Are you sure you want to delete ${selectedGroup.name}?`}
          onCancel={() => {
            deleteGroupDisclosure.onClose();
            setSelectedGroup(null);
          }}
          onSubmit={() => {
            deleteGroupDisclosure.onClose();
            setSelectedGroup(null);
          }}
        />
      )}
      {groupDisclosure.isOpen && (
        <Modal
          open={groupDisclosure.isOpen}
          onOpenChange={(open) => {
            if (!open) {
              groupDisclosure.onClose();
              setSelectedGroup(null);
            }
          }}
        >
          <ModalContent>
            <ValidatedForm
              action={path.to.configurationParameterGroup(itemId)}
              method="post"
              validator={configurationParameterGroupValidator}
              fetcher={fetcher}
              defaultValues={{
                id: selectedGroup?.id,
                name: selectedGroup?.name,
              }}
              onSubmit={() => {
                setSelectedGroup(null);
                groupDisclosure.onClose();
              }}
            >
              <ModalHeader>
                <ModalTitle>{selectedGroup ? "Edit" : "Add"} Group</ModalTitle>
              </ModalHeader>
              <ModalBody>
                <Hidden name="id" />
                <Input name="name" label="Name" />
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={groupDisclosure.onClose}
                >
                  Cancel
                </Button>
                <Submit
                  isDisabled={
                    fetcher.state !== "idle" &&
                    fetcher.formAction ===
                      path.to.configurationParameterGroup(itemId)
                  }
                  isLoading={
                    fetcher.state !== "idle" &&
                    fetcher.formAction ===
                      path.to.configurationParameterGroup(itemId)
                  }
                >
                  Save
                </Submit>
              </ModalFooter>
            </ValidatedForm>
          </ModalContent>
        </Modal>
      )}
    </>
  );

  function onDragStart(event: DragStartEvent) {
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

    const activeGroup = groups.find((g) => g.id === activeId);
    const overGroup = over.data.current?.group;

    if (!activeGroup || !overGroup) return;

    let sortOrderBefore = 0;
    let sortOrderAfter = 0;

    if (activeGroup.sortOrder > overGroup.sortOrder) {
      // Moving up - insert before the over item
      sortOrderAfter = overGroup.sortOrder;

      // Find the previous group's sort order
      for (let i = groups.length - 1; i >= 0; i--) {
        const group = groups[i];
        if (group.sortOrder < overGroup.sortOrder) {
          sortOrderBefore = group.sortOrder;
          break;
        }
      }
    } else {
      // Moving down - insert after the over item
      sortOrderBefore = overGroup.sortOrder;

      // Find the next group's sort order
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        if (group.sortOrder > overGroup.sortOrder) {
          sortOrderAfter = group.sortOrder;
          break;
        }
      }
      if (sortOrderAfter === 0) {
        sortOrderAfter = sortOrderBefore + 1;
      }
    }

    const newSortOrder = (sortOrderBefore + sortOrderAfter) / 2;

    submit(
      {
        id: activeGroup.id,
        sortOrder: newSortOrder,
      },
      {
        method: "post",
        action: path.to.configurationParameterGroupOrder(itemId),
        navigate: false,
        fetcherKey: `group:${activeGroup.id}`,
      }
    );
  }

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    if (!hasDraggableData(active) || !hasDraggableData(over)) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    const isActiveAnParameter = activeData?.type === "parameter";
    const isOverAnParameter = overData?.type === "parameter";

    const activeParameter = parametersById.get(activeId.toString());
    const overParameter = parametersById.get(overId.toString());

    if (!isActiveAnParameter) return;

    // dropping an option over another option
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
            label: activeParameter.label,
            key: activeParameter.key,
            dataType: activeParameter.dataType,
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
            label: activeParameter.label,
            key: activeParameter.key,
            dataType: activeParameter.dataType,
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

    // dropping an option over a group
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
            label: activeParameter.label,
            key: activeParameter.key,
            dataType: activeParameter.dataType,
          },
          {
            method: "post",
            action: path.to.configurationParameterOrder(activeParameter.itemId),
            navigate: false,
            fetcherKey: `parameter:${activeParameter.id}`,
          }
        );
      }
    }
  }
}

const variants = cva("border rounded-lg", {
  variants: {
    dragging: {
      default: "",
      over: "ring-2 opacity-30",
      overlay: "ring-2 ring-primary",
    },
  },
});

function ParameterGroup({
  group,
  isOverlay,
  parameters,
  groupDisclosure,
  deleteGroupDisclosure,
  setSelectedGroup,
}: {
  group: ConfigurationParameterGroup;
  parameters: ConfigurationParameter[];
  isOverlay?: boolean;
  deleteGroupDisclosure: ReturnType<typeof useDisclosure>;
  groupDisclosure: ReturnType<typeof useDisclosure>;
  setSelectedGroup: (group: ConfigurationParameterGroup) => void;
}) {
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

  return (
    <div
      key={group.id}
      ref={setNodeRef}
      style={style}
      className={variants({
        dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
      })}
    >
      <div
        className={cn("p-4 bg-muted/30", parameters.length > 0 && "border-b")}
      >
        <HStack className="w-full justify-between">
          <HStack>
            <IconButton
              aria-label="Reorder Group"
              icon={<LuGripVertical />}
              variant="ghost"
              isDisabled={group.id === "null"}
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
                icon={<LuEllipsisVertical />}
                variant="ghost"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  flushSync(() => {
                    setSelectedGroup(group);
                  });
                  groupDisclosure.onOpen();
                }}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                destructive
                disabled={group.isUngrouped}
                onClick={() => {
                  flushSync(() => {
                    setSelectedGroup(group);
                  });
                  deleteGroupDisclosure.onOpen();
                }}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </HStack>
      </div>
      <SortableContext items={parameters.map((opt) => opt.id)}>
        <div
          className={cn("flex flex-col gap-2", parameters.length > 0 && "p-2")}
        >
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
  isOverlay,
}: {
  parameter: ConfigurationParameter;
  isOverlay?: boolean;
}) {
  const { isList, key, onChangeCheckForListType, updateKey } =
    useConfigurationParameters(parameter);

  const disclosure = useDisclosure();
  const deleteParameterDisclosure = useDisclosure();
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
  }, [disclosure, fetcher.state]);

  const isUpdated = parameter.updatedBy !== null;
  const person = isUpdated ? parameter.updatedBy : parameter.createdBy;
  const date = parameter.updatedAt ?? parameter.createdAt;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "p-4 bg-card",
        variants({
          dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
        })
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
                      <ConfiguratorDataTypeIcon type={type} className="mr-2" />
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
                isLoading={
                  fetcher.state !== "idle" &&
                  fetcher.formAction ===
                    path.to.configurationParameter(parameter.itemId)
                }
              >
                Save
              </Submit>
            </HStack>
          </VStack>
        </ValidatedForm>
      ) : (
        <div className="flex flex-col gap-2 w-full">
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
                  <ConfiguratorDataTypeIcon
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
                    icon={<LuEllipsisVertical />}
                    variant="ghost"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={disclosure.onOpen}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    onClick={deleteParameterDisclosure.onOpen}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {parameter.dataType === "material" && (
            <div className="py-4 px-8 bg-muted/30 rounded-md">
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <span className="text-xs text-muted-foreground">ID</span>
                  <div className="text-sm font-mono">{parameter.key}.id</div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Material Form
                  </span>
                  <div className="text-sm font-mono">
                    {parameter.key}.materialFormId
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Substance
                  </span>
                  <div className="text-sm font-mono">
                    {parameter.key}.materialSubstanceId
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Dimension
                  </span>
                  <div className="text-sm font-mono">
                    {parameter.key}.dimensionId
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Grade</span>
                  <div className="text-sm font-mono">
                    {parameter.key}.gradeId
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Finish</span>
                  <div className="text-sm font-mono">
                    {parameter.key}.finishId
                  </div>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">
                    Material Type
                  </span>
                  <div className="text-sm font-mono">
                    {parameter.key}.materialTypeId
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {deleteParameterDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteConfigurationParameter(
            parameter.itemId,
            parameter.id
          )}
          isOpen={deleteParameterDisclosure.isOpen}
          name={parameter.label}
          text={`Are you sure you want to delete the ${parameter.label} parameter? This will not update any formulas that are using this parameter.`}
          onCancel={() => {
            deleteParameterDisclosure.onClose();
          }}
          onSubmit={() => {
            deleteParameterDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

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

function usePendingGroups({ itemId }: { itemId: string }) {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return (
        fetcher.formAction === path.to.configurationParameterGroupOrder(itemId)
      );
    })
    .map((fetcher) => {
      let id = String(fetcher.formData.get("id"));
      let sortOrder = Number(fetcher.formData.get("sortOrder"));
      return { id, sortOrder };
    });
}

function usePendingParameters({ itemId }: { itemId: string }) {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.configurationParameterOrder(itemId);
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
