import type { Json } from "@carbon/database";
import {
  Boolean,
  DatePicker,
  InputControlled,
  NumberControlled,
  Select,
  ValidatedForm,
} from "@carbon/form";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { useCustomFieldsSchema } from "~/hooks/useCustomFieldsSchema";
import { DataType } from "~/modules/shared";
import { Enumerable } from "../Enumerable";
import Customer from "./Customer";
import Employee from "./Employee";
import Supplier from "./Supplier";

type CustomFormInlineFieldsProps = {
  customFields: Record<string, Json>;
  table: string;
  tags?: string[];
  isDisabled?: boolean;
  onUpdate: (value: string) => void | Promise<void>;
};

const CustomFormInlineFields = ({
  customFields: fields = {},
  table,
  tags = [],
  isDisabled = false,
  onUpdate,
}: CustomFormInlineFieldsProps) => {
  const customFormSchema = useCustomFieldsSchema();
  const tableFields = customFormSchema?.[table];

  if (!fields) return null;
  if (!tableFields) return null;

  return (
    <>
      {tableFields
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((field) => {
          if (
            !field.tags ||
            !Array.isArray(field.tags) ||
            field.tags.length === 0
          )
            return true;
          return field.tags.some((tag) => tags.includes(tag));
        })
        .map((field) => {
          switch (field.dataTypeId) {
            case DataType.Boolean:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]:
                      fields && field.id in fields
                        ? (fields[field.id] as boolean)
                        : false,
                  }}
                  validator={z.object({
                    [field.id]: zfd.checkbox(),
                  })}
                  className="w-full"
                >
                  <Boolean
                    label={field.name}
                    name={field.id}
                    variant="small"
                    isDisabled={isDisabled}
                    onChange={(value) => {
                      onUpdate(
                        JSON.stringify({
                          ...fields,
                          [field.id]: value ? "on" : "",
                        })
                      );
                    }}
                  />
                </ValidatedForm>
              );
            case DataType.Date:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]: fields[field.id] as string,
                  }}
                  validator={z.object({
                    [field.id]: zfd.text(z.string().optional()),
                  })}
                  className="w-full"
                >
                  <DatePicker
                    name={field.id}
                    label={field.name}
                    inline
                    isDisabled={isDisabled}
                    onChange={(date) => {
                      const modifiedDate =
                        date === null ? null : date.split("T")[0];
                      onUpdate(
                        JSON.stringify({
                          ...fields,
                          [field.id]: modifiedDate,
                        })
                      );
                    }}
                  />
                </ValidatedForm>
              );
            case DataType.List:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]: fields[field.id] as string,
                  }}
                  validator={z.object({
                    [field.id]: zfd.text(z.string().optional()),
                  })}
                  className="w-full"
                >
                  <Select
                    name={field.id}
                    label={field.name}
                    inline={(value, options) => {
                      return <Enumerable value={value} />;
                    }}
                    isReadOnly={isDisabled}
                    options={
                      field.listOptions?.map((option) => ({
                        value: option,
                        label: option,
                      })) ?? []
                    }
                    onChange={(value) => {
                      onUpdate(
                        JSON.stringify({
                          ...fields,
                          [field.id]: value?.value ?? null,
                        })
                      );
                    }}
                  />
                </ValidatedForm>
              );
            case DataType.Numeric:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]: fields[field.id] as number,
                  }}
                  validator={z.object({
                    [field.id]: zfd.numeric(
                      z.number().min(0, { message: "Quantity is required" })
                    ),
                  })}
                  className="w-full"
                >
                  <NumberControlled
                    label={field.name}
                    name={field.id}
                    inline
                    isReadOnly={isDisabled}
                    value={fields[field.id] as number}
                    onChange={(value) => {
                      onUpdate(
                        JSON.stringify({
                          ...fields,
                          [field.id]: value,
                        })
                      );
                    }}
                  />
                </ValidatedForm>
              );
            case DataType.Text:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]: fields[field.id] as string,
                  }}
                  validator={z.object({
                    [field.id]: zfd.text(z.string().optional()),
                  })}
                  className="w-full"
                >
                  <InputControlled
                    name={field.id}
                    label={field.name}
                    value={fields[field.id] as string}
                    size="sm"
                    inline
                    isReadOnly={isDisabled}
                    onBlur={(e) => {
                      onUpdate(
                        JSON.stringify({
                          ...fields,
                          [field.id]: e.target.value,
                        })
                      );
                    }}
                  />
                </ValidatedForm>
              );
            case DataType.User:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]: fields[field.id] as string,
                  }}
                  validator={z.object({
                    [field.id]: zfd.text(z.string().optional()),
                  })}
                  className="w-full"
                >
                  <Employee
                    name={field.id}
                    label={field.name}
                    inline
                    isReadOnly={isDisabled}
                    onChange={(value) => {
                      if (value?.value) {
                        onUpdate(
                          JSON.stringify({
                            ...fields,
                            [field.id]: value.value,
                          })
                        );
                      }
                    }}
                  />
                </ValidatedForm>
              );
            case DataType.Customer:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]: fields[field.id] as string,
                  }}
                  validator={z.object({
                    [field.id]: zfd.text(z.string().optional()),
                  })}
                  className="w-full"
                >
                  <Customer
                    name={field.id}
                    label={field.name}
                    inline
                    isReadOnly={isDisabled}
                    onChange={(value) => {
                      if (value?.value) {
                        onUpdate(
                          JSON.stringify({
                            ...fields,
                            [field.id]: value.value,
                          })
                        );
                      }
                    }}
                  />
                </ValidatedForm>
              );
            case DataType.Supplier:
              return (
                <ValidatedForm
                  defaultValues={{
                    [field.id]: fields[field.id] as string,
                  }}
                  validator={z.object({
                    [field.id]: zfd.text(z.string().optional()),
                  })}
                  className="w-full"
                >
                  <Supplier
                    name={field.id}
                    label={field.name}
                    inline
                    isReadOnly={isDisabled}
                    onChange={(value) => {
                      if (value?.value) {
                        onUpdate(
                          JSON.stringify({
                            ...fields,
                            [field.id]: value.value,
                          })
                        );
                      }
                    }}
                  />
                </ValidatedForm>
              );
            default:
              return null;
          }
        })}
    </>
  );
};

export default CustomFormInlineFields;
