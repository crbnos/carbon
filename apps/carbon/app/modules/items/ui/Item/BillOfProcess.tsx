"use client";
import type { JSONContent } from "@carbon/react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Editor,
  HStack,
  cn,
  toast,
} from "@carbon/react";
import { ValidatedForm } from "@carbon/remix-validated-form";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useCallback, useState } from "react";
import { LuSettings2, LuX } from "react-icons/lu";
import { DirectionAwareTabs } from "~/components/DirectionAwareTabs";
import {
  EquipmentType,
  InputControlled,
  Number,
  NumberControlled,
  StandardFactor,
  WorkCellType,
} from "~/components/Form";
import type { Item } from "~/components/SortableList";
import { SortableList, SortableListItem } from "~/components/SortableList";

// type Process = {
//   workCenterTypeId: string;
//   equipmentTypeId?: string;
//   setupHours: number;
//   standardFactor: StandardFactor;
//   productionStandard: number;
// };

export const workInstructions = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: {
        level: 2,
      },
      content: [
        {
          type: "text",
          text: "Work Instruction",
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 3,
      },
      content: [
        {
          type: "text",
          text: "Setup ",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "I'm baby letterpress franzen palo santo offal. XOXO lumbersexual farm-to-table mustache neutra selfies chillwave aesthetic green juice blue bottle letterpress fanny pack try-hard gorpcore. Selvage marfa butcher kale chips craft beer fashion axe lumbersexual mlkshk truffaut etsy same salvia activated charcoal kogi woke. Hoodie green juice put a bird on it, echo park swag disrupt ugh air plant vaporware vice hammock.",
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "Slow-carb fam same vexillologist bitters.",
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "Roof party franzen slow-carb heirloom viral small batch. ",
                },
              ],
            },
          ],
        },
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "Bitters next level listicle, +1 same godard 90's big mood heirloom shabby chic hella.",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "heading",
      attrs: {
        level: 3,
      },
      content: [
        {
          type: "text",
          text: "Run",
        },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: {
            checked: false,
          },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",

                  text: "DIY enamel pin viral ramps banjo DSA chartreuse.",
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "paragraph",
    },
  ],
};

const initialState = [
  {
    id: "1",
    text: "Plasma Cut",
    checked: false,
    description: "",
  },
  {
    id: "2",
    text: "Deburring",
    checked: false,
    description: "",
  },
  {
    id: "3",
    text: "Brake Press",
    checked: false,
    description: "",
  },
  {
    id: "5",
    text: "Paint",
    checked: false,
    description: "",
  },
];

const BillOfProcess = () => {
  const [items, setItems] = useState<Item[]>(initialState);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [tabChangeRerender, setTabChangeRerender] = useState<number>(1);

  const onCompleteItem = (id: string) => {
    setItems((prevItems) =>
      prevItems.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item
      )
    );
  };

  const onAddItem = () => {
    setItems((prevItems) => [
      ...prevItems,
      {
        text: `Item ${prevItems.length + 1}`,
        checked: false,
        id: Math.random().toString(16).slice(2),
        description: "",
      },
    ]);
  };

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

  const renderListItem = (
    item: Item,
    order: number,
    onCompleteItem: (id: string) => void,
    onRemoveItem: (id: string) => void
  ) => {
    const isOpen = item.id === openItemId;

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
              <ValidatedForm className="w-full flex flex-col gap-y-4">
                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                  <WorkCellType
                    name="workCellTypeId"
                    label="Work Cell"
                    onChange={(value) => {
                      // onWorkCellChange(value?.value as string);
                    }}
                  />
                  <EquipmentType
                    name="equipmentTypeId"
                    label="Equipment"
                    onChange={(value) =>
                      // onEquipmentChange(value?.value as string)
                      console.log(value)
                    }
                  />
                </div>
                <InputControlled
                  name="description"
                  label="Description"
                  value={""}
                  // value={workCellData.description}
                  onChange={(newValue) => {
                    // setWorkCellData((d) => ({ ...d, description: newValue }));
                  }}
                />
                <div className="grid w-full gap-x-8 gap-y-4 grid-cols-1 lg:grid-cols-3">
                  <NumberControlled
                    name="setupHours"
                    label="Setup Time (hours)"
                    minValue={0}
                    value={0}
                    // value={equipmentData.setupHours}
                    onChange={(newValue) => {
                      console.log(newValue);
                      // setEquipmentData((d) => ({ ...d, setupHours: newValue }));
                    }}
                  />
                  <Number
                    name="productionStandard"
                    label="Production Standard"
                    minValue={0}
                  />
                  <StandardFactor
                    name="standardFactor"
                    label="Standard Factor"
                  />
                </div>
              </ValidatedForm>
            </motion.div>
          </div>
        ),
      },
      {
        id: 1,
        label: "Work Instructions",
        content: (
          <div className="flex flex-col p-2">
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
                initialValue={workInstructions as JSONContent}
                onChange={(value) => console.log(value)}
              />
            </motion.div>
          </div>
        ),
      },
    ];

    return (
      <SortableListItem
        item={item}
        order={order}
        key={item.id}
        isExpanded={isOpen}
        onCompleteItem={onCompleteItem}
        onRemoveItem={onRemoveItem}
        handleDrag={onCloseOnDrag}
        className="my-2 "
        renderExtra={(item) => (
          <div
            key={`${isOpen}`}
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-2 ",
              isOpen ? "py-1 px-1" : "py-3 "
            )}
          >
            <motion.button
              layout
              onClick={() => setOpenItemId(!isOpen ? item.id : null)}
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

            <LayoutGroup id={`${item.id}`}>
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

                    <motion.div
                      key={`re-render-${tabChangeRerender}`} //  re-animates the button section on tab change
                      className="flex w-full items-center justify-end p-2"
                      initial={{ opacity: 0, filter: "blur(4px)" }}
                      animate={{ opacity: 1, filter: "blur(0px)" }}
                      transition={{
                        type: "spring",
                        bounce: 0,
                        duration: 0.55,
                      }}
                    >
                      <motion.div layout className="ml-auto mr-1  pt-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setOpenItemId(null);
                            toast.info("Changes saved");
                          }}
                        >
                          Save
                        </Button>
                      </motion.div>
                    </motion.div>
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
          <CardTitle>Bill of Processes</CardTitle>
        </CardHeader>

        <CardAction>
          <Button variant="secondary" onClick={onAddItem}>
            Add Process
          </Button>
        </CardAction>
      </HStack>
      <CardContent>
        <SortableList
          items={items}
          setItems={setItems}
          onCompleteItem={onCompleteItem}
          renderItem={renderListItem}
        />
      </CardContent>
    </Card>
  );
};

export default BillOfProcess;
