"use client";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  HStack,
  VStack,
  cn,
  toast,
  useDebounce,
  useMount,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useFetcher, useParams } from "@remix-run/react";
import type { FileObject } from "@supabase/storage-js";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { nanoid } from "nanoid";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import { LuMove3D, LuPaperclip, LuSettings2, LuX } from "react-icons/lu";
import type { z } from "zod";
import { DirectionAwareTabs } from "~/components/DirectionAwareTabs";
import {
  ArrayNumeric,
  Hidden,
  Input,
  InputControlled,
  Item,
  Submit,
  UnitOfMeasure,
} from "~/components/Form";
import type {
  Item as SortableItem,
  SortableItemRenderProps,
} from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";
import { useUser } from "~/hooks";
import { useSupabase } from "~/lib/supabase";
import type { ModelUpload } from "~/modules/items";
import { CadModel } from "~/modules/items";
import { path } from "~/utils/path";
import { salesRfqLineValidator } from "../../sales.models";
import SalesRFQLineDocuments from "./SalesRFQLineDocuments";

type Line = z.infer<typeof salesRfqLineValidator> & {
  internalNotes: JSONContent;
  externalNotes: JSONContent;
} & ModelUpload;

type ItemWithData = SortableItem & {
  data: Line;
  files?: (FileObject & { salesRfqLineId: string | null })[];
};

type SalesRFQLinesProps = {
  lines: Line[];
  files: (FileObject & { salesRfqLineId: string | null })[];
};

function makeItems(
  lines: Line[],
  files: (FileObject & { salesRfqLineId: string | null })[]
): ItemWithData[] {
  return lines.map((line) =>
    makeItem(
      line,
      files.filter((f) => {
        return f.salesRfqLineId === line.id;
      })
    )
  );
}

function makeItem(
  line: Line,
  files?: (FileObject & { salesRfqLineId: string | null })[]
): ItemWithData {
  return {
    id: line.id!,
    title: (
      <VStack spacing={0}>
        <h4 className="font-mono">
          {line.customerPartNumber}{" "}
          {line.customerRevisionId && `(${line.customerRevisionId})`}
        </h4>
        {line?.description && (
          <span className="text-xs text-muted-foreground">
            {line.description}{" "}
          </span>
        )}
      </VStack>
    ),
    isTemporary: false,
    checked: false,
    details: (
      <HStack spacing={2}>
        {line.quantity.map((q, i) => (
          <Badge key={i} variant="secondary">
            {q}
          </Badge>
        ))}
        {line.autodeskUrn && (
          <Badge variant="secondary">
            <LuMove3D className="w-4 h-4 text-green-500" />
          </Badge>
        )}
        {files && files.length > 0 && (
          <Badge variant="secondary">
            <LuPaperclip className="w-4 h-4" />
          </Badge>
        )}
      </HStack>
    ),
    data: line,
    files,
  };
}

const initialLine: Omit<Line, "id" | "salesRfqId" | "order"> = {
  customerPartNumber: "",
  customerRevisionId: "",
  itemId: "",
  description: "",
  quantity: [1],
  unitOfMeasureCode: "EA",
  modelUploadId: undefined,
  autodeskUrn: null,
  modelId: "",
  modelName: "",
  modelPath: null,
  modelSize: 0,
  thumbnailPath: null,
  internalNotes: {} as JSONContent,
  externalNotes: {} as JSONContent,
};

const SalesRFQLines = ({ lines, files }: SalesRFQLinesProps) => {
  const { rfqId } = useParams();
  if (!rfqId) throw new Error("rfqId not found");

  const fetcher = useFetcher<{}>();
  const { supabase } = useSupabase();
  const {
    company: { id: companyId },
    id: userId,
  } = useUser();

  const [items, setItems] = useState<ItemWithData[]>(
    makeItems(lines ?? [], files)
  );
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);

  useEffect(() => {
    setItems(makeItems(lines, files));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const onToggleItem = (id: string) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  useMount(() => {
    if (lines.length === 0 && !selectedLineId) {
      onAddItem();
    }
  });

  // we create a temporary item and append it to the list
  const onAddItem = () => {
    const id = nanoid();
    setSelectedLineId(id);
    setItems((prevItems) => {
      let newOrder = 1;
      if (prevItems.length) {
        newOrder = prevItems[prevItems.length - 1].data.order + 1;
      }

      return [
        ...prevItems,
        {
          title: "",
          checked: false,
          id: id,
          isTemporary: true,
          data: {
            ...initialLine,
            id,
            order: newOrder,
            salesRfqId: rfqId,
          },
        },
      ];
    });
  };

  const onRemoveItem = async (id: string) => {
    // get the item and it's order in the list
    const itemIndex = items.findIndex((i) => i.id === id);
    const item = items[itemIndex];

    setItems((prevItems) => prevItems.filter((item) => item.id !== id));

    fetcher.submit(new FormData(), {
      method: "post",
      action: path.to.deleteSalesRfqLine(rfqId, item.id),
    });
  };

  const onReorder = (reorderedItems: ItemWithData[]) => {
    const newItems = reorderedItems.map((item, index) => ({
      ...item,
      data: {
        ...item.data,
        order: index + 1,
      },
    }));
    const updates = newItems.reduce<Record<string, number>>((acc, item) => {
      if (!item.isTemporary) {
        acc[item.id] = item.data.order;
      }
      return acc;
    }, {});

    setItems(reorderedItems);
    updateSortOrder(updates);
  };

  const updateSortOrder = useDebounce((updates: Record<string, number>) => {
    let formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    fetcher.submit(formData, {
      method: "post",
      action: path.to.salesRfqLinesOrder(rfqId),
    });
  }, 1000);

  const onCloseOnDrag = useCallback(() => {
    setItems((prevItems) => {
      const updatedItems = prevItems.map((item) =>
        item.checked ? { ...item, checked: false } : item
      );
      return updatedItems.some(
        (item, index) => item.checked !== prevItems[index].checked
      )
        ? updatedItems
        : prevItems;
    });
  }, []);

  const onUploadImage = async (file: File) => {
    const fileName = `${companyId}/sales-rfqs/${selectedLineId}:${Math.random()
      .toString(16)
      .slice(2)}-${file.name}`;
    const result = await supabase?.storage
      .from("private")
      .upload(fileName, file);

    if (result?.error) {
      throw new Error(result.error.message);
    }

    if (!result?.data) {
      throw new Error("Failed to upload image");
    }

    return `/file/preview/private/${result.data.path}`;
  };

  const onUpdateInternalNotes = useDebounce(async (content: JSONContent) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === selectedLineId
          ? {
              ...item,
              data: {
                ...item.data,
                internalNotes: content,
              },
            }
          : item
      )
    );
    await supabase
      ?.from("salesRfqLine")
      .update({
        internalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", selectedLineId!);
  }, 1000);

  const onUpdateExternalNotes = useDebounce(async (content: JSONContent) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === selectedLineId
          ? {
              ...item,
              data: {
                ...item.data,
                externalNotes: content,
              },
            }
          : item
      )
    );
    await supabase
      ?.from("salesRfqLine")
      .update({
        externalNotes: content,
        updatedAt: today(getLocalTimeZone()).toString(),
        updatedBy: userId,
      })
      .eq("id", selectedLineId!);
  }, 1000);

  const [tabChangeRerender, setTabChangeRerender] = useState<number>(1);
  const renderListItem = ({
    item,
    items,
    order,
    onToggleItem,
    onRemoveItem,
  }: SortableItemRenderProps<ItemWithData>) => {
    const isOpen = item.id === selectedLineId;

    const tabs = [
      {
        id: 0,
        label: "Details",
        content: (
          <div className="flex w-full flex-col pr-2 py-2">
            <motion.div
              initial={{ opacity: 0, filter: "blur(4px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              transition={{
                type: "spring",
                bounce: 0.2,
                duration: 0.75,
                delay: 0.15,
              }}
            >
              <SalesRFQLineForm
                item={item}
                setItems={setItems}
                setSelectedLineId={setSelectedLineId}
              />
            </motion.div>
          </div>
        ),
      },
    ];

    if (!item.isTemporary) {
      tabs.push(
        {
          id: 1,
          label: "Model",

          content: (
            <div className="flex flex-col py-4">
              <motion.div
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{
                  type: "spring",
                  bounce: 0.2,
                  duration: 0.75,
                  delay: 0.15,
                }}
              >
                <CadModel
                  autodeskUrn={item.data.autodeskUrn ?? null}
                  metadata={{
                    salesRfqLineId: item.id,
                  }}
                  modelPath={item.data.modelPath ?? null}
                  uploadClassName="min-h-[300px]"
                />
              </motion.div>
            </div>
          ),
        },
        {
          id: 2,
          label: "Files",

          content: (
            <div className="flex flex-col">
              <motion.div
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{
                  type: "spring",
                  bounce: 0.2,
                  duration: 0.75,
                  delay: 0.15,
                }}
              >
                <SalesRFQLineDocuments
                  files={item.files ?? []}
                  modelUpload={item.data}
                  rfqId={rfqId}
                  salesRfqLineId={item.id}
                />
              </motion.div>
            </div>
          ),
        },
        {
          id: 3,
          label: "Internal Notes",

          content: (
            <div className="flex flex-col">
              <motion.div
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{
                  type: "spring",
                  bounce: 0.2,
                  duration: 0.75,
                  delay: 0.15,
                }}
              >
                <Editor
                  className="min-h-[300px]"
                  initialValue={item.data.internalNotes}
                  onUpload={onUploadImage}
                  onChange={onUpdateInternalNotes}
                />
              </motion.div>
            </div>
          ),
        },
        {
          id: 4,
          label: "External Notes",

          content: (
            <div className="flex flex-col">
              <motion.div
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                transition={{
                  type: "spring",
                  bounce: 0.2,
                  duration: 0.75,
                  delay: 0.15,
                }}
              >
                <Editor
                  className="min-h-[300px]"
                  initialValue={item.data.externalNotes ?? ({} as JSONContent)}
                  onUpload={onUploadImage}
                  onChange={onUpdateExternalNotes}
                />
              </motion.div>
            </div>
          ),
        }
      );
    }

    return (
      <SortableListItem<Line>
        item={item}
        items={items}
        order={order}
        key={`${item.id}:${item.isTemporary}`}
        isExpanded={isOpen}
        onToggleItem={onToggleItem}
        onRemoveItem={onRemoveItem}
        handleDrag={onCloseOnDrag}
        className="my-2 "
        renderExtra={(item) => (
          <div
            key={`${isOpen}:${item.isTemporary}`}
            className={cn(
              "flex h-full flex-col items-center justify-center pl-2",
              isOpen ? "py-1" : "py-3 "
            )}
          >
            <motion.button
              layout
              onClick={
                isOpen
                  ? () => {
                      if (item.isTemporary) {
                        setItems((prevItems) =>
                          prevItems.filter((i) => i.id !== item.id)
                        );
                      }
                      setSelectedLineId(null);
                    }
                  : () => {
                      setSelectedLineId(item.id);
                    }
              }
              key="collapse"
              className={cn(
                isOpen
                  ? "absolute right-3 top-3 z-10 "
                  : "relative z-10 ml-auto mr-3 "
              )}
            >
              {isOpen ? (
                <motion.span
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{
                    type: "spring",
                    duration: 1.95,
                  }}
                >
                  <LuX className="h-5 w-5 text-foreground" />
                </motion.span>
              ) : (
                <motion.span
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 1, filter: "blur(0px)" }}
                  transition={{
                    type: "spring",
                    duration: 0.95,
                  }}
                >
                  <LuSettings2 className="stroke-1 h-5 w-5 text-foreground/80  hover:stroke-primary/70 " />
                </motion.span>
              )}
            </motion.button>

            <LayoutGroup id={`${item.id}:${item.isTemporary}`}>
              <AnimatePresence mode="popLayout">
                {isOpen ? (
                  <motion.div className="flex w-full flex-col ">
                    <div className=" w-full p-2">
                      <motion.div
                        initial={{
                          y: 0,
                          opacity: 0,
                          filter: "blur(4px)",
                        }}
                        animate={{
                          y: 0,
                          opacity: 1,
                          filter: "blur(0px)",
                        }}
                        transition={{
                          type: "spring",
                          duration: 0.15,
                        }}
                        layout
                        className="w-full "
                      >
                        <DirectionAwareTabs
                          className="mr-auto"
                          tabs={tabs}
                          onChange={() =>
                            setTabChangeRerender(tabChangeRerender + 1)
                          }
                        />
                      </motion.div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </LayoutGroup>
          </div>
        )}
      />
    );
  };

  return (
    <Card>
      <HStack className="justify-between">
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>

        <CardAction>
          <Button
            variant="secondary"
            isDisabled={selectedLineId !== null}
            onClick={onAddItem}
          >
            Add Line
          </Button>
        </CardAction>
      </HStack>
      <CardContent>
        <SortableList
          items={items}
          onReorder={onReorder}
          onToggleItem={onToggleItem}
          onRemoveItem={onRemoveItem}
          renderItem={renderListItem}
        />
      </CardContent>
    </Card>
  );
};

export default SalesRFQLines;

function SalesRFQLineForm({
  item,
  setItems,
  setSelectedLineId,
}: {
  item: ItemWithData;
  setItems: Dispatch<SetStateAction<ItemWithData[]>>;
  setSelectedLineId: Dispatch<SetStateAction<string | null>>;
}) {
  const { supabase } = useSupabase();
  const salesRfqLineFetcher = useFetcher<{ id: string }>();

  const { company } = useUser();

  useEffect(() => {
    if (salesRfqLineFetcher.data && salesRfqLineFetcher.data.id) {
      setItems((prevItems) => {
        return prevItems.map((i) =>
          i.id === item.id
            ? {
                ...i,
                isTemporary: false,
                data: {
                  ...i.data,
                },
              }
            : i
        );
      });
    }
  }, [item.id, salesRfqLineFetcher.data, setItems, setSelectedLineId]);

  const [itemData, setItemData] = useState<{
    itemId: string;
    description: string;
    unitOfMeasureCode: string;
    modelUploadId: string | null;
  }>({
    itemId: item.data.itemId ?? "",
    description: item.data.description ?? "",
    unitOfMeasureCode: item.data.unitOfMeasureCode ?? "EA",
    modelUploadId: item.data.modelUploadId ?? null,
  });

  const onItemChange = async (itemId: string) => {
    if (!supabase) return;

    const item = await supabase
      .from("item")
      .select("name, unitOfMeasureCode, modelUploadId")
      .eq("id", itemId)
      .eq("companyId", company.id)
      .single();

    if (item.error) {
      toast.error("Failed to load item details");
      return;
    }

    setItemData((d) => ({
      ...d,
      itemId,
      description: item.data?.name ?? "",
      unitOfMeasureCode: item.data?.unitOfMeasureCode ?? "EA",
      modelUploadId: item.data?.modelUploadId ?? null,
    }));
  };

  return (
    <ValidatedForm
      action={
        item.isTemporary
          ? path.to.newSalesRFQLine(item.data.salesRfqId!)
          : path.to.salesRfqLine(item.data.salesRfqId, item.id!)
      }
      method="post"
      defaultValues={item.data}
      validator={salesRfqLineValidator}
      className="w-full"
      fetcher={salesRfqLineFetcher}
      onSubmit={(values) => {
        setItems((prevItems) =>
          prevItems.map((i) =>
            i.id === item.id
              ? {
                  ...makeItem({
                    ...item.data,
                    ...values,
                  }),
                  isTemporary: false,
                  id: item.id,
                }
              : i
          )
        );
      }}
    >
      <Hidden name="id" />
      <Hidden name="salesRfqId" />
      <Hidden name="order" />
      <Hidden
        name="modelUploadId"
        value={itemData.modelUploadId ?? undefined}
      />
      <VStack className="pt-4">
        <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
          <Input
            name="customerPartNumber"
            label="Customer Part Number"
            autoFocus
          />
          <Input name="customerRevisionId" label="Customer Revision" />
          <Item
            name="itemId"
            label="Part"
            type="Part"
            onChange={(value) => {
              onItemChange(value?.value as string);
            }}
          />
          <InputControlled
            name="description"
            label="Description"
            value={itemData.description}
            onChange={(newValue) => {
              setItemData((d) => ({ ...d, description: newValue }));
            }}
          />
          <UnitOfMeasure
            name="unitOfMeasureCode"
            value={itemData.unitOfMeasureCode}
            onChange={(newValue) =>
              setItemData((d) => ({
                ...d,
                unitOfMeasureCode: newValue?.value ?? "EA",
              }))
            }
          />
          <ArrayNumeric
            name="quantity"
            label="Quantity"
            defaults={[1, 25, 50, 100]}
          />
        </div>

        <motion.div
          className="flex w-full items-center justify-end p-2"
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{
            type: "spring",
            bounce: 0,
            duration: 0.55,
          }}
        >
          <motion.div layout className="ml-auto mr-1 pt-2">
            <Submit>Save</Submit>
          </motion.div>
        </motion.div>
      </VStack>
    </ValidatedForm>
  );
}
