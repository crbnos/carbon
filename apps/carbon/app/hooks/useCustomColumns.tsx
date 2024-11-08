import type { Json } from "@carbon/database";
import { Checkbox, HStack } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  LuCalendar,
  LuCaseSensitive,
  LuEuro,
  LuList,
  LuToggleLeft,
  LuUser,
} from "react-icons/lu";
import { Avatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { DataType } from "~/modules/shared";
import { usePeople } from "~/stores";
import { useCustomFieldsSchema } from "./useCustomFieldsSchema";

export function useCustomColumns<T extends { customFields: Json }>(
  table: string
) {
  const customFieldsSchemas = useCustomFieldsSchema();
  const schema = customFieldsSchemas?.[table];

  const customColumns: ColumnDef<T>[] = [];
  const [people] = usePeople();

  schema?.forEach((field) => {
    customColumns.push({
      accessorKey: `customFields.${field.id}`,
      header: field.name,
      meta: {
        icon: <ColumnIcon dataTypeId={field.dataTypeId} />,
      },
      cell: (item) => {
        switch (field.dataTypeId) {
          case DataType.Boolean:
            return isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields ? (
              <Checkbox
                isChecked={item.row.original?.customFields[field.id] === "on"}
              />
            ) : (
              <Checkbox isChecked={false} />
            );
          case DataType.Date:
            return isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields
              ? item.row.original?.customFields[field.id]
              : null;
          case DataType.List:
            return isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields ? (
              <Enumerable value={item.getValue<string>()} />
            ) : null;
          case DataType.Numeric:
            return isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields
              ? item.row.original?.customFields[field.id]
              : null;
          case DataType.Text:
            return isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields
              ? item.row.original?.customFields[field.id]
              : null;
          case DataType.User:
            if (
              isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields
            ) {
              const personId = item.row.original?.customFields[
                field.id
              ] as string;
              const person = people.find((person) => person.id === personId);
              if (!person) return null;

              return (
                <HStack>
                  <Avatar
                    size="sm"
                    name={person.name}
                    path={person.avatarUrl}
                  />
                  <p>{person.name}</p>
                </HStack>
              );
            } else {
              return null;
            }

          default:
            return null;
        }
      },
    });
  });

  return customColumns as ColumnDef<T>[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function ColumnIcon({ dataTypeId }: { dataTypeId: DataType }) {
  switch (dataTypeId) {
    case DataType.Boolean:
      return <LuToggleLeft />;
    case DataType.Date:
      return <LuCalendar />;
    case DataType.List:
      return <LuList />;
    case DataType.Numeric:
      return <LuEuro />;
    case DataType.Text:
      return <LuCaseSensitive />;
    case DataType.User:
      return <LuUser />;
    default:
      return null;
  }
}
