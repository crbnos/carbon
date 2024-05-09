import {
  ActionMenu,
  Button,
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  HStack,
  IconButton,
  MenuIcon,
  MenuItem,
  useDisclosure,
} from "@carbon/react";
import { Link, useFetcher, useParams } from "@remix-run/react";
import { Reorder } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AiOutlineNumber } from "react-icons/ai";
import { BiText } from "react-icons/bi";
import { BsCalendarDate, BsToggleOn } from "react-icons/bs";
import { CgProfile } from "react-icons/cg";
import { LuPencil, LuTrash } from "react-icons/lu";
import { MdOutlineDragIndicator } from "react-icons/md";
import { New } from "~/components";
import { ConfirmDelete } from "~/components/Modals";
import { useUrlParams } from "~/hooks";
import type { AttributeDataType } from "~/modules/resources";
import type { CustomField, CustomFieldsTableType } from "~/modules/settings";
import { path } from "~/utils/path";

type CustomFieldCategoryDetailProps = {
  customFieldTable: CustomFieldsTableType;
  dataTypes: AttributeDataType[];
  onClose: () => void;
};

type CustomFieldAndDataType = CustomField & {
  dataType: AttributeDataType;
};

const CustomFieldCategoryDetail = ({
  customFieldTable,
  dataTypes,
  onClose,
}: CustomFieldCategoryDetailProps) => {
  const sortOrderFetcher = useFetcher();
  const { tableId } = useParams();
  if (!tableId) throw new Error("tableId is not found");
  const [params] = useUrlParams();

  const getAttributeDataType = useCallback(
    (id: number) => {
      return dataTypes.find((dt) => dt.id === id);
    },
    [dataTypes]
  );

  const fieldMap = useMemo(
    () =>
      Array.isArray(customFieldTable.fields)
        ? customFieldTable.fields.reduce<
            Record<string, CustomFieldAndDataType>
            // @ts-ignore
          >((acc, field) => {
            if (!field) return acc;
            const customField = field as CustomFieldAndDataType;
            return {
              ...acc,
              [customField.id]: {
                ...customField,
                dataType: getAttributeDataType(customField.dataTypeId),
              },
            };
          }, {})
        : {},
    [customFieldTable.fields, getAttributeDataType]
  ) as Record<string, CustomFieldAndDataType>;

  const [sortOrder, setSortOrder] = useState<string[]>(
    Array.isArray(customFieldTable.fields)
      ? customFieldTable.fields
          .sort(
            (a, b) =>
              (a as CustomField).sortOrder - (b as CustomField).sortOrder
          )
          .map((field) => (field as CustomField).id)
      : []
  );

  useEffect(() => {
    setSortOrder(
      Array.isArray(customFieldTable.fields)
        ? customFieldTable.fields
            .sort(
              (a, b) =>
                (a as CustomField).sortOrder - (b as CustomField).sortOrder
            )
            .map((field) => (field as CustomField).id)
        : []
    );
  }, [customFieldTable.fields, getAttributeDataType]);

  const onReorder = (newOrder: string[]) => {
    let updates: Record<string, number> = {};
    newOrder.forEach((id, index) => {
      if (id !== sortOrder[index]) {
        updates[id] = index + 1;
      }
    });
    setSortOrder(newOrder);
    updateSortOrder(updates);
  };

  const updateSortOrder = (updates: Record<string, number>) => {
    let formData = new FormData();
    formData.append("updates", JSON.stringify(updates));
    sortOrderFetcher.submit(formData, { method: "post" });
  };

  const deleteModal = useDisclosure();
  const [selectedCustomField, setSelectedCustomField] = useState<
    CustomField | undefined
  >();

  const onDelete = (data?: CustomField) => {
    setSelectedCustomField(data);
    deleteModal.onOpen();
  };

  const onDeleteCancel = () => {
    setSelectedCustomField(undefined);
    deleteModal.onClose();
  };

  const renderContextMenu = (fieldId: string) => {
    return (
      <>
        <MenuItem asChild>
          <Link to={`${fieldId}?${params.toString()}`}>
            <MenuIcon icon={<LuPencil />} />
            Edit Custom Field
          </Link>
        </MenuItem>
        <MenuItem onClick={() => onDelete(fieldMap[fieldId])}>
          <MenuIcon icon={<LuTrash />} />
          Delete Custom Field
        </MenuItem>
      </>
    );
  };

  return (
    <>
      <Drawer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{customFieldTable.name}</DrawerTitle>
            <DrawerDescription>{customFieldTable.module}</DrawerDescription>
          </DrawerHeader>
          <DrawerBody>
            {Array.isArray(customFieldTable?.fields) && (
              <Reorder.Group
                axis="y"
                values={sortOrder}
                onReorder={onReorder}
                className="space-y-2 w-full"
              >
                {sortOrder.map((sortId) => {
                  return (
                    <Reorder.Item
                      key={sortId}
                      value={sortId}
                      className="rounded-lg w-full"
                    >
                      <HStack>
                        <IconButton
                          aria-label="Drag handle"
                          icon={<MdOutlineDragIndicator />}
                          variant="ghost"
                        />
                        <p className="flex-grow text-foreground">
                          {fieldMap[sortId]?.name}
                        </p>
                        <Button
                          isDisabled
                          leftIcon={
                            getIcon(fieldMap[sortId]?.dataType) ?? undefined
                          }
                          variant="ghost"
                        >
                          {fieldMap[sortId]?.dataType?.label ?? "Unknown"}
                        </Button>
                        <ActionMenu>{renderContextMenu(sortId)}</ActionMenu>
                      </HStack>
                    </Reorder.Item>
                  );
                })}
              </Reorder.Group>
            )}
          </DrawerBody>
          <DrawerFooter>
            <Button asChild size="md">
              <New label="Custom Field" to={`new?${params?.toString()}`} />
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
      {selectedCustomField && selectedCustomField.id && (
        <ConfirmDelete
          isOpen={deleteModal.isOpen}
          action={path.to.deleteCustomField(tableId, selectedCustomField.id)}
          name={selectedCustomField?.name ?? ""}
          text={`Are you sure you want to delete the ${selectedCustomField?.name} field?`}
          onSubmit={onDeleteCancel}
          onCancel={onDeleteCancel}
        />
      )}
    </>
  );
};

function getIcon(props: AttributeDataType) {
  if (!props) return null;
  const { isBoolean, isDate, isNumeric, isText, isUser } = props;
  if (isBoolean) return <BsToggleOn />;
  if (isDate) return <BsCalendarDate />;
  if (isNumeric) return <AiOutlineNumber />;
  if (isText) return <BiText />;
  if (isUser) return <CgProfile />;
}

export default CustomFieldCategoryDetail;
