import {
  Boolean,
  DatePicker,
  Input,
  Number,
  Select,
  useAdditionalValidatorsContext
} from "@carbon/form";
import { useEffect } from "react";
import { useCustomFieldsSchema } from "~/hooks/useCustomFieldsSchema";
import { DataType } from "~/modules/shared";
import Customer from "./Customer";
import Employee from "./Employee";
import Supplier from "./Supplier";

type CustomFormFieldsProps = {
  table: string;
  tags?: string[];
};

const CustomFormFields = ({ table, tags = [] }: CustomFormFieldsProps) => {
  const customFormSchema = useCustomFieldsSchema();
  const tableFields = customFormSchema?.[table];
  const additionalValidatorCtx = useAdditionalValidatorsContext();
  const tagsKey = tags.join(",");

  useEffect(() => {
    if (!additionalValidatorCtx || !tableFields) return;

    const requiredFields = tableFields.filter((field) => {
      if (!field.required || field.dataTypeId === DataType.Boolean)
        return false;
      if (!field.tags || field.tags.length === 0) return true;
      return field.tags.some((tag) => tags.includes(tag));
    });

    if (requiredFields.length === 0) return;

    additionalValidatorCtx.register(`custom-${table}`, (formData) => {
      const errors: Record<string, string | undefined> = {};
      for (const field of requiredFields) {
        const name = getCustomFieldName(field.id);
        const value = formData.get(name);
        if (!value || (typeof value === "string" && value.trim() === "")) {
          errors[name] = "Required";
        }
      }
      return errors;
    });

    return () => additionalValidatorCtx.unregister(`custom-${table}`);
    // tagsKey stabilizes the tags array for the dep comparison
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableFields, tagsKey, table, additionalValidatorCtx]);

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
          const isRequired = field.required ?? false;
          switch (field.dataTypeId) {
            case DataType.Boolean:
              return (
                <Boolean
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                />
              );
            case DataType.Date:
              return (
                <DatePicker
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.List:
              return (
                <Select
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  placeholder={`Select ${field.name}`}
                  isRequired={isRequired}
                  options={
                    field.listOptions?.map((o) => ({
                      label: o,
                      value: o
                    })) ?? []
                  }
                />
              );
            case DataType.Numeric:
              return (
                <Number
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.Text:
              return (
                <Input
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.User:
              return (
                <Employee
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.Customer:
              return (
                <Customer
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            case DataType.Supplier:
              return (
                <Supplier
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  isRequired={isRequired}
                />
              );
            default:
              return null;
          }
        })}
    </>
  );
};

export default CustomFormFields;

function getCustomFieldName(id: string) {
  return `custom-${id}`;
}
