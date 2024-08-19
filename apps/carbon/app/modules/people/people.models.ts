import { z } from "zod";
import { zfd } from "zod-form-data";
import { DataType } from "~/modules/shared";

export const attributeValidator = z
  .object({
    id: zfd.text(z.string().optional()),
    name: z.string().min(1, { message: "Name is required" }),
    userAttributeCategoryId: z.string().min(20),
    attributeDataTypeId: zfd.numeric(),
    listOptions: z.string().min(1).array().optional(),
    canSelfManage: zfd.checkbox(),
  })
  .refine((input) => {
    // allows bar to be optional only when foo is 'foo'
    if (
      input.attributeDataTypeId === DataType.List &&
      (input.listOptions === undefined ||
        input.listOptions.length === 0 ||
        input.listOptions.some((option) => option.length === 0))
    )
      return false;

    return true;
  });

export const attributeCategoryValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  isPublic: zfd.checkbox(),
});

export const departmentValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  parentDepartmentId: zfd.text(z.string().optional()),
});

export const employeeJobValidator = z.object({
  title: zfd.text(z.string().optional()),
  startDate: zfd.text(z.string().optional()),
  locationId: zfd.text(z.string().optional()),
  shiftId: zfd.text(z.string().optional()),
  managerId: zfd.text(z.string().optional()),
});

export const holidayValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  date: z.string().min(1, { message: "Date is required" }),
});

export const shiftValidator = z.object({
  id: zfd.text(z.string().optional()),
  name: z.string().min(1, { message: "Name is required" }),
  startTime: z.string().min(1, { message: "Start time is required" }),
  endTime: z.string().min(1, { message: "End time is required" }),
  locationId: z.string().min(1, { message: "Location is required" }),
  monday: zfd.checkbox(),
  tuesday: zfd.checkbox(),
  wednesday: zfd.checkbox(),
  thursday: zfd.checkbox(),
  friday: zfd.checkbox(),
  saturday: zfd.checkbox(),
  sunday: zfd.checkbox(),
});
