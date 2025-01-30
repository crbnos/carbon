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
  ClientOnly,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  HStack,
  IconButton,
  ModalCard,
  ModalCardBody,
  ModalCardHeader,
  ModalCardProvider,
  ModalCardTitle,
  toast,
  useDisclosure,
  VStack,
} from "@carbon/react";
import { formatRelativeTime } from "@carbon/utils";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useFetcher,
  useFetchers,
  useParams,
  useSubmit,
} from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  LuCirclePlus,
  LuEllipsisVertical,
  LuGripVertical,
} from "react-icons/lu";
import { EmployeeAvatar } from "~/components";
import { ConfiguratorDataTypeIcon } from "~/components/Configurator/Icons";
import { ConfirmDelete } from "~/components/Modals";
import { configurationParameterDataTypes } from "~/modules/items/items.models";
import type { action as batchPropertyAction } from "~/routes/x+/inventory+/batch-property+/$itemId.property";
import { path } from "~/utils/path";
import { capitalize } from "~/utils/string";
import { batchPropertyValidator } from "../inventory.models";
import type { BatchProperty } from "../types";

export default function BatchPropertiesForm({
  properties: initialProperties,
  type = "card",
  onClose,
}: {
  properties: BatchProperty[];
  type?: "card" | "modal";
  onClose?: () => void;
}) {
  const { isList, itemId, onChangeCheckForListType, setIsList } =
    useBatchProperties();

  const submit = useSubmit();
  const fetcher = useFetcher<typeof batchPropertyAction>();

  useEffect(() => {
    if (fetcher.data?.success === false) {
      toast.error("Failed to update batch property");
    }
  }, [fetcher.data]);

  const propertiesById = new Map<string, BatchProperty>(
    initialProperties.map((property) => [property.id, property])
  );

  const pendingProperties = usePendingProperties({ itemId });

  // merge pending properties and existing properties
  for (let pendingProperty of pendingProperties) {
    let property = propertiesById.get(pendingProperty.id);
    if (property) {
      propertiesById.set(pendingProperty.id, {
        ...property,
        ...pendingProperty,
      });
    }
  }

  const properties = Array.from(propertiesById.values()).sort(
    (a, b) => a.sortOrder - b.sortOrder
  );
  const [activeProperty, setActiveProperty] = useState<BatchProperty | null>(
    null
  );

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor)
  );

  return (
    <ModalCardProvider type={type}>
      <ModalCard onClose={onClose}>
        <ModalCardHeader>
          <ModalCardTitle>Batch Properties</ModalCardTitle>
        </ModalCardHeader>

        <ModalCardBody>
          <div className="flex flex-col gap-4">
            <div className="p-6 border rounded-lg">
              <ValidatedForm
                action={path.to.batchProperty(itemId)}
                method="post"
                fetcher={fetcher}
                validator={batchPropertyValidator}
                resetAfterSubmit
                onSubmit={() => {
                  setIsList(false);
                }}
                defaultValues={{
                  itemId: itemId,
                  label: "",
                  dataType: "text",
                  listOptions: [],
                }}
                className="w-full"
              >
                <Hidden name="id" />
                <Hidden name="itemId" />
                <VStack spacing={4}>
                  <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    <VStack>
                      <Input name="label" label="Label" />
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
                      <ArrayInput name="listOptions" label="List Options" />
                    )}
                  </div>
                  <HStack spacing={2}>
                    <Submit
                      leftIcon={<LuCirclePlus />}
                      isDisabled={fetcher.state !== "idle"}
                      isLoading={fetcher.state !== "idle"}
                    >
                      Add Property
                    </Submit>
                  </HStack>
                </VStack>
              </ValidatedForm>
            </div>

            {properties.length > 0 && (
              <DndContext
                sensors={sensors}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              >
                <SortableContext items={properties.map((p) => p.id)}>
                  <div className="flex flex-col gap-2">
                    {properties.map((property) => (
                      <BatchPropertyComponent
                        key={property.id}
                        property={property}
                      />
                    ))}
                  </div>
                </SortableContext>
                <ClientOnly fallback={null}>
                  {() =>
                    createPortal(
                      <DragOverlay>
                        {activeProperty && (
                          <BatchPropertyComponent
                            property={activeProperty}
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
        </ModalCardBody>
      </ModalCard>
    </ModalCardProvider>
  );

  function onDragStart(event: DragStartEvent) {
    const { active } = event;
    const activeProperty = properties.find((p) => p.id === active.id);
    if (activeProperty) {
      setActiveProperty(activeProperty);
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveProperty(null);

    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const activeIndex = properties.findIndex((p) => p.id === activeId);
    const overIndex = properties.findIndex((p) => p.id === overId);

    if (activeIndex === -1 || overIndex === -1) return;

    const activeProperty = properties[activeIndex];
    const overProperty = properties[overIndex];

    let newSortOrder: number;

    if (activeIndex > overIndex) {
      // Moving up
      const prevProperty = properties[overIndex - 1];
      newSortOrder = prevProperty
        ? (prevProperty.sortOrder + overProperty.sortOrder) / 2
        : overProperty.sortOrder / 2;
    } else {
      // Moving down
      const nextProperty = properties[overIndex + 1];
      newSortOrder = nextProperty
        ? (overProperty.sortOrder + nextProperty.sortOrder) / 2
        : overProperty.sortOrder + 1;
    }

    submit(
      {
        id: activeProperty.id,
        sortOrder: newSortOrder,
      },
      {
        method: "post",
        action: path.to.batchPropertyOrder(itemId),
        navigate: false,
      }
    );
  }
}

function BatchPropertyComponent({
  property,
  isOverlay,
}: {
  property: BatchProperty;
  isOverlay?: boolean;
}) {
  const { isList, onChangeCheckForListType } = useBatchProperties(property);

  const disclosure = useDisclosure();
  const deletePropertyDisclosure = useDisclosure();
  const submitted = useRef(false);
  const fetcher = useFetcher<typeof batchPropertyAction>();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: property.id,
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

  const isUpdated = property.updatedBy !== null;
  const person = isUpdated ? property.updatedBy : property.createdBy;
  const date = property.updatedAt ?? property.createdAt;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "p-4 bg-card border rounded-lg",
        isOverlay ? "ring-2 ring-primary" : isDragging && "opacity-30"
      )}
    >
      {disclosure.isOpen ? (
        <ValidatedForm
          action={path.to.batchProperty(property.itemId)}
          method="post"
          validator={batchPropertyValidator}
          fetcher={fetcher}
          resetAfterSubmit
          onSubmit={() => {
            disclosure.onClose();
          }}
          defaultValues={{
            id: property.id,
            itemId: property.itemId,
            label: property.label,
            dataType: property.dataType,
            listOptions: property.listOptions ?? [],
          }}
        >
          <Hidden name="id" />
          <Hidden name="itemId" />

          <VStack spacing={4}>
            <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <VStack>
                <Input name="label" label="Label" autoFocus />
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
              {isList && <ArrayInput name="listOptions" label="List Options" />}
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
                <ConfiguratorDataTypeIcon
                  type={property.dataType}
                  className="w-4 h-4"
                />
              </div>
              <VStack spacing={0}>
                <span className="text-sm font-medium">{property.label}</span>
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
                  onClick={deletePropertyDisclosure.onOpen}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      {deletePropertyDisclosure.isOpen && (
        <ConfirmDelete
          action={path.to.deleteBatchProperty(property.itemId, property.id)}
          isOpen={deletePropertyDisclosure.isOpen}
          name={property.label}
          text={`Are you sure you want to delete the ${property.label} property?`}
          onCancel={() => {
            deletePropertyDisclosure.onClose();
          }}
          onSubmit={() => {
            deletePropertyDisclosure.onClose();
          }}
        />
      )}
    </div>
  );
}

function useBatchProperties(property?: BatchProperty) {
  const { itemId } = useParams();
  if (!itemId) throw new Error("Could not find itemId");

  const [isList, setIsList] = useState(property?.dataType === "list");

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

  return {
    isList,
    itemId,
    onChangeCheckForListType,
    setIsList,
  };
}

function usePendingProperties({ itemId }: { itemId: string }) {
  type PendingItem = ReturnType<typeof useFetchers>[number] & {
    formData: FormData;
  };
  return useFetchers()
    .filter((fetcher): fetcher is PendingItem => {
      return fetcher.formAction === path.to.batchPropertyOrder(itemId);
    })
    .map((fetcher) => {
      let id = String(fetcher.formData.get("id"));
      let sortOrder = Number(fetcher.formData.get("sortOrder"));
      return { id, sortOrder };
    });
}
