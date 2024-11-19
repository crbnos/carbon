import { Boolean, DatePicker, Input, Number, Select } from "@carbon/form";
import { useCustomFieldsSchema } from "~/hooks/useCustomFieldsSchema";
import { DataType } from "~/modules/shared";
import Employee from "./Employee";

type CustomFormFieldsProps = {
  table: string;
  tags?: string[];
};

const CustomFormFields = ({ table, tags = [] }: CustomFormFieldsProps) => {
  const customFormSchema = useCustomFieldsSchema();
  const tableFields = customFormSchema?.[table];

  if (!tableFields) return null;

  return (
    <>
      {tableFields
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((field) => {
          if (!field.tags || !Array.isArray(field.tags)) return true;
          return field.tags.some((tag) => tags.includes(tag));
        })
        .map((field) => {
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
                />
              );
            case DataType.List:
              return (
                <Select
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                  placeholder={`Select ${field.name}`}
                  options={
                    field.listOptions?.map((o) => ({
                      label: o,
                      value: o,
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
                />
              );
            case DataType.Text:
              return (
                <Input
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
                />
              );
            case DataType.User:
              return (
                <Employee
                  key={field.id}
                  name={getCustomFieldName(field.id)}
                  label={field.name}
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
