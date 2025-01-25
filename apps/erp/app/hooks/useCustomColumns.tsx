import type { Json } from "@carbon/database";
import { Checkbox } from "@carbon/react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  LuCalendar,
  LuCaseSensitive,
  LuContainer,
  LuEuro,
  LuList,
  LuSquareUser,
  LuToggleLeft,
  LuUser,
} from "react-icons/lu";
import { CustomerAvatar, EmployeeAvatar, SupplierAvatar } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { DataType } from "~/modules/shared";
import { useCustomers, usePeople, useSuppliers } from "~/stores";
import { path } from "~/utils/path";
import { useCustomFieldsSchema } from "./useCustomFieldsSchema";

export function useCustomColumns<T extends { customFields: Json }>(
  table: string
) {
  const customFieldsSchemas = useCustomFieldsSchema();
  const schema = customFieldsSchemas?.[table];

  const customColumns: ColumnDef<T>[] = [];
  const [people] = usePeople();
  const [customers] = useCustomers();
  const [suppliers] = useSuppliers();

  schema?.forEach((field) => {
    customColumns.push({
      accessorKey: `customFields->>${field.id}`,
      header: field.name,
      meta: {
        icon: <ColumnIcon dataTypeId={field.dataTypeId} />,
        filter:
          field.dataTypeId === DataType.Boolean
            ? {
                type: "static",
                options: [
                  { value: "on", label: "Yes" },
                  { value: "", label: "No" },
                ],
              }
            : field.dataTypeId === DataType.List
            ? {
                type: "static",
                options:
                  field.listOptions?.map((option) => ({
                    value: option,
                    label: <Enumerable value={option} />,
                  })) || [],
              }
            : field.dataTypeId === DataType.User
            ? {
                type: "static",
                options: people.map((person) => ({
                  value: person.id,
                  label: person.name,
                })),
              }
            : field.dataTypeId === DataType.Text
            ? {
                type: "fetcher",
                endpoint: path.to.api.customFieldOptions(table, field.id),
              }
            : field.dataTypeId === DataType.Customer
            ? {
                type: "static",
                options: customers.map((customer) => ({
                  value: customer.id,
                  label: customer.name,
                })),
              }
            : field.dataTypeId === DataType.Supplier
            ? {
                type: "static",
                options: suppliers.map((supplier) => ({
                  value: supplier.id,
                  label: supplier.name,
                })),
              }
            : undefined,
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

              return <EmployeeAvatar employeeId={personId} />;
            } else {
              return null;
            }
          case DataType.Customer:
            if (
              isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields
            ) {
              const customerId = item.row.original?.customFields[
                field.id
              ] as string;

              return <CustomerAvatar customerId={customerId} />;
            } else {
              return null;
            }
          case DataType.Supplier:
            if (
              isObject(item.row.original.customFields) &&
              field.id in item.row.original.customFields
            ) {
              const supplierId = item.row.original?.customFields[
                field.id
              ] as string;

              return <SupplierAvatar supplierId={supplierId} />;
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
    case DataType.Customer:
      return <LuSquareUser />;
    case DataType.Supplier:
      return <LuContainer />;
    default:
      return null;
  }
}
