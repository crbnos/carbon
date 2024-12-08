import type { Database } from "@carbon/database";
import type {
  getCustomers,
  getEmployees,
  getEmployeeTypes,
  getModules,
  getPermissionsByEmployeeType,
  getSuppliers,
  getUsers,
} from "./users.service";

export type Customer = NonNullable<
  Awaited<ReturnType<typeof getCustomers>>["data"]
>[number];

export type Employee = NonNullable<
  Awaited<ReturnType<typeof getEmployees>>["data"]
>[number];

export type EmployeeInsert = Database["public"]["Tables"]["employee"]["Insert"];

export type InviteInsert = Database["public"]["Tables"]["invite"]["Insert"];

export type EmployeeTypePermission = NonNullable<
  Awaited<ReturnType<typeof getPermissionsByEmployeeType>>["data"]
>[number];

export type EmployeeType = NonNullable<
  Awaited<ReturnType<typeof getEmployeeTypes>>["data"]
>[number];

export type Module = NonNullable<
  Awaited<ReturnType<typeof getModules>>["data"]
>[number];

export type Group = {
  data: {
    id: string;
    companyId: string;
    isEmployeeTypeGroup: boolean;
    isCustomerOrgGroup: boolean;
    isCustomerTypeGroup: boolean;
    isSupplierOrgGroup: boolean;
    isSupplierTypeGroup: boolean;
    name: string;
    users: User[];
  };
  children: Group[];
};

export type CompanyPermission = {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
};

export type Permission = {
  view: string[];
  create: string[];
  update: string[];
  delete: string[];
};

export type Supplier = NonNullable<
  Awaited<ReturnType<typeof getSuppliers>>["data"]
>[number];

export type User = NonNullable<
  Awaited<ReturnType<typeof getUsers>>["data"]
>[number];
