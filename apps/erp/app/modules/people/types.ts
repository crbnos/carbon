import type {
  getAttribute,
  getAttributeCategories,
  getAttributeCategory,
  getDepartments,
  getEmployeeJob,
  getEmployeeSummary,
  getHolidays,
  getPeople,
  getShifts,
} from "./people.service";

export type Attribute = NonNullable<
  Awaited<ReturnType<typeof getAttribute>>["data"]
>;

export type AttributeCategory = NonNullable<
  Awaited<ReturnType<typeof getAttributeCategories>>["data"]
>[number];

export type AttributeCategoryDetailType = NonNullable<
  Awaited<ReturnType<typeof getAttributeCategory>>["data"]
>;

export type AttributeDataType = {
  id: number;
  label: string;
  isBoolean: boolean;
  isDate: boolean;
  isList: boolean;
  isNumeric: boolean;
  isText: boolean;
  isUser: boolean;
  isCustomer: boolean;
  isSupplier: boolean;
};

export type Department = NonNullable<
  Awaited<ReturnType<typeof getDepartments>>["data"]
>[number];

export type EmployeeJob = NonNullable<
  Awaited<ReturnType<typeof getEmployeeJob>>["data"]
>;

export type EmployeeSummary = NonNullable<
  Awaited<ReturnType<typeof getEmployeeSummary>>["data"]
>;

export type Holiday = NonNullable<
  Awaited<ReturnType<typeof getHolidays>>["data"]
>[number];

export type Person = NonNullable<
  Awaited<ReturnType<typeof getPeople>>["data"]
>[number];

export type Shift = NonNullable<
  Awaited<ReturnType<typeof getShifts>>["data"]
>[number];
