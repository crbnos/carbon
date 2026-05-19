import type { Database, Json } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DataType } from "~/modules/shared";
import type { Employee } from "~/modules/users";
import { getEmployees } from "~/modules/users/users.service";
import { AuthContextHolder, getAuthClient, mcpTool } from "~/services/mcp";
import type { GenericQueryFilters } from "~/utils/query";
import { setGenericQueryFilters } from "~/utils/query";
import { sanitize } from "~/utils/supabase";
import type {
  departmentValidator,
  employeeJobValidator,
  holidayValidator,
  shiftValidator
} from "./people.models";
export const deleteAttribute = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteAttribute(attributeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("userAttribute")
      .update({ active: false })
      .eq("id", attributeId);
  }
);

export const deleteAttributeCategory = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteAttributeCategory(attributeCategoryId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("userAttributeCategory")
      .update({ active: false })
      .eq("id", attributeCategoryId);
  }
);

export const deleteDepartment = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteDepartment(departmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("department").delete().eq("id", departmentId);
  }
);

export const deleteHoliday = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteHoliday(holidayId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("holiday").delete().eq("id", holidayId);
  }
);

export const deleteShift = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteShift(shiftId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    // TODO: Set all employeeShifts to null
    return client.from("shift").update({ active: false }).eq("id", shiftId);
  }
);

export const getAttribute = mcpTool(
  {
    classification: "READ"
  },
  async function getAttribute(attributeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("userAttribute")
      .select("*, userAttributeCategory(name)")
      .eq("id", attributeId)
      .eq("active", true)
      .single();
  }
);

async function getAttributes(userIds: string[]) {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
  return client
    .from("userAttributeCategory")
    .select(
      `*,
      userAttribute(id, name, listOptions, canSelfManage,
        attributeDataType(id, isBoolean, isDate, isNumeric, isText, isUser, isFile),
        userAttributeValue(
          id, userId, valueBoolean, valueDate, valueNumeric, valueText, valueUser, valueFile, user!userAttributeValue_userId_fkey(id, fullName, avatarUrl)
        )
      )`
    )
    .eq("companyId", companyId)
    .eq("userAttribute.active", true)
    .in("userAttribute.userAttributeValue.userId", userIds)
    .order("sortOrder", { foreignTable: "userAttribute", ascending: true });
}

export const getAttributeCategories = mcpTool(
  {
    classification: "READ"
  },
  async function getAttributeCategories(
    args?: { search: string | null } & GenericQueryFilters
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("userAttributeCategory")
      .select("*, userAttribute(id, name, attributeDataType(id))", {
        count: "exact"
      })
      .eq("companyId", companyId)
      .eq("active", true)
      .eq("userAttribute.active", true);

    if (args?.search) {
      query = query.ilike("name", `%${args.search}%`);
    }

    if (args) {
      query = setGenericQueryFilters(query, args, [
        { column: "name", ascending: true }
      ]);
    }

    return query;
  }
);

export const getAttributeCategory = mcpTool(
  {
    classification: "READ"
  },
  async function getAttributeCategory(id: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("userAttributeCategory")
      .select(
        `*,
      userAttribute(
        id, name, sortOrder,
        attributeDataType(id, label, isBoolean, isDate, isList, isNumeric, isText, isUser, isFile))
      `,
        {
          count: "exact"
        }
      )
      .eq("id", id)
      .eq("active", true)
      .eq("userAttribute.active", true)
      .single();
  }
);

export const getAttributeDataTypes = mcpTool(
  {
    classification: "READ"
  },
  async function getAttributeDataTypes() {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("attributeDataType").select("*");
  }
);

export const getDepartment = mcpTool(
  {
    classification: "READ"
  },
  async function getDepartment(departmentId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("department")
      .select("*")
      .eq("id", departmentId)
      .single();
  }
);

export const getDepartments = mcpTool(
  {
    classification: "READ"
  },
  async function getDepartments(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("department")
      .select(`*, department(id, name)`, {
        count: "exact"
      })
      .eq("companyId", companyId);

    if (args?.search) {
      query = query.ilike("name", `%${args.search}%`);
    }

    if (args) {
      query = setGenericQueryFilters(query, args, [
        { column: "name", ascending: true }
      ]);
    }

    return query;
  }
);

export const getDepartmentsList = mcpTool(
  {
    classification: "READ"
  },
  async function getDepartmentsList() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("department")
      .select(`id, name`)
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getDepartmentsTree = mcpTool(
  {
    classification: "READ"
  },
  async function getDepartmentsTree() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("department")
      .select("id, name, parentDepartmentId")
      .eq("companyId", companyId)
      .order("name");
  }
);

export const getEmployeeJob = mcpTool(
  {
    classification: "READ"
  },
  async function getEmployeeJob(employeeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("employeeJob")
      .select("*")
      .eq("id", employeeId)
      .eq("companyId", companyId)
      .single();
  }
);

export const getEmployeeSummary = mcpTool(
  {
    classification: "READ"
  },
  async function getEmployeeSummary(employeeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("employeeSummary")
      .select("*")
      .eq("id", employeeId)
      .eq("companyId", companyId)
      .single();
  }
);

export const getHoliday = mcpTool(
  {
    classification: "READ"
  },
  async function getHoliday(holidayId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("holiday").select("*").eq("id", holidayId).single();
  }
);

export const getHolidays = mcpTool(
  {
    classification: "READ"
  },
  async function getHolidays(
    args?: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("holiday")
      .select("*", {
        count: "exact"
      })
      .eq("companyId", companyId);

    if (args?.search) {
      query = query.ilike("name", `%${args.search}%`);
    }

    if (args) {
      query = setGenericQueryFilters(query, args, [
        { column: "date", ascending: true }
      ]);
    }

    return query;
  }
);

export function getHolidayYears() {
  const client = getAuthClient<SupabaseClient<Database>>();
  const { companyId } = AuthContextHolder.get();
  return client.from("holidayYears").select("year").eq("companyId", companyId);
}

type UserAttributeId = string;

export type PersonAttributeValue = {
  userAttributeValueId: string;
  value: boolean | string | number;
  dataType?: DataType;
  user?: {
    id: string;
    fullName: string | null;
    avatarUrl: string | null;
  } | null;
};

type PersonAttributes = Record<UserAttributeId, PersonAttributeValue>;

type Person = Employee & {
  attributes: PersonAttributes;
};

export const getPeople = mcpTool(
  {
    classification: "READ"
  },
  async function getPeople(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const employees = await getEmployees(args);
    if (employees.error) return employees;

    if (!employees.data) throw new Error("Failed to get employee data");

    const userIds = employees.data.reduce<string[]>((acc, employee) => {
      if (employee.id) acc.push(employee.id);
      return acc;
    }, []);

    const attributeCategories = await getAttributes(userIds);
    if (attributeCategories.error) return attributeCategories;

    const people: Person[] = employees.data.map((employee) => {
      const employeeAttributes =
        attributeCategories.data.reduce<PersonAttributes>((acc, category) => {
          if (!category.userAttribute || !Array.isArray(category.userAttribute))
            return acc;
          category.userAttribute.forEach(
            // @ts-ignore
            (attribute) => {
              if (
                attribute.userAttributeValue &&
                Array.isArray(attribute.userAttributeValue) &&
                !Array.isArray(attribute.attributeDataType)
              ) {
                const userAttributeId = attribute.id;
                const userAttributeValue = attribute.userAttributeValue.find(
                  // @ts-ignore
                  (attributeValue) => true
                );
                const value =
                  typeof userAttributeValue?.valueBoolean === "boolean"
                    ? userAttributeValue.valueBoolean
                    : userAttributeValue?.valueDate ||
                      userAttributeValue?.valueNumeric ||
                      userAttributeValue?.valueText ||
                      userAttributeValue?.valueUser ||
                      userAttributeValue?.valueFile;

                if (value && userAttributeValue?.id) {
                  acc[userAttributeId] = {
                    userAttributeValueId: userAttributeValue.id,
                    // @ts-ignore
                    dataType: attribute.attributeDataType?.id as DataType,
                    value,
                    user: !Array.isArray(userAttributeValue.user)
                      ? userAttributeValue.user
                      : undefined
                  };
                }
              }
            }
          );
          return acc;
        }, {});

      return {
        ...employee,
        attributes: employeeAttributes
      };
    });

    return {
      count: employees.count,
      data: people,
      error: null
    };
  }
);

export const getContacts = mcpTool(
  {
    classification: "READ"
  },
  async function getContacts(
    args: GenericQueryFilters & {
      search: string | null;
    }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("contact")
      .select("*", { count: "exact" })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.or(
        `firstName.ilike.%${args.search}%,lastName.ilike.%${args.search}%,email.ilike.%${args.search}%`
      );
    }

    query = setGenericQueryFilters(query, args, [
      { column: "lastName", ascending: true }
    ]);

    const contacts = await query;

    if (!contacts.data) throw new Error("Failed to get contacts data");

    return {
      count: contacts.count,
      data: contacts.data,
      error: null
    };
  }
);
export const getShift = mcpTool(
  {
    classification: "READ"
  },
  async function getShift(shiftId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .eq("active", true)
      .single();
  }
);

export const getShifts = mcpTool(
  {
    classification: "READ"
  },
  async function getShifts(
    args: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("shifts")
      .select("*", {
        count: "exact"
      })
      .eq("companyId", companyId)
      .eq("active", true);

    if (args?.search) {
      query = query.ilike("name", `%${args.search}%`);
    }

    query = setGenericQueryFilters(query, args, [
      { column: "locationId", ascending: true }
    ]);
    return query;
  }
);

export const getShiftsList = mcpTool(
  {
    classification: "READ"
  },
  async function getShiftsList(locationId: string | null) {
    const client = getAuthClient<SupabaseClient<Database>>();
    let query = client.from("shift").select(`id, name`).eq("active", true);

    if (locationId) {
      query = query.eq("locationId", locationId);
    }

    return query.order("name");
  }
);

export const insertAttribute = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertAttribute(attribute: {
    name: string;
    attributeDataTypeId: number;
    userAttributeCategoryId: string;
    listOptions?: string[];
    canSelfManage: boolean;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId: createdBy } = AuthContextHolder.get();
    // TODO: there's got to be a better way to get the max
    const sortOrders = await client
      .from("userAttribute")
      .select("sortOrder")
      .eq("userAttributeCategoryId", attribute.userAttributeCategoryId);

    if (sortOrders.error) return sortOrders;
    const maxSortOrder = sortOrders.data.reduce((max, item) => {
      return Math.max(max, item.sortOrder);
    }, 0);

    return client
      .from("userAttribute")
      .upsert([{ ...attribute, sortOrder: maxSortOrder + 1, createdBy }])
      .select("id")
      .single();
  }
);

export const insertAttributeCategory = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertAttributeCategory(attributeCategory: {
    name: string;
    emoji?: string;
    public: boolean;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { userId: createdBy } = AuthContextHolder.get();
    return client
      .from("userAttributeCategory")
      .upsert([{ ...attributeCategory, createdBy }])
      .select("id")
      .single();
  }
);

export const insertEmployeeJob = mcpTool(
  {
    classification: "WRITE"
  },
  async function insertEmployeeJob(job: { id: string; locationId?: string }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("employeeJob")
      .insert({ ...job, companyId })
      .select("*")
      .single();
  }
);

export const updateAttribute = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAttribute(attribute: {
    id?: string;
    name: string;
    listOptions?: string[];
    canSelfManage: boolean;
  }) {
    const { userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    if (!attribute.id) throw new Error("id is required");
    return client
      .from("userAttribute")
      .update(
        sanitize({
          name: attribute.name,
          listOptions: attribute.listOptions,
          canSelfManage: attribute.canSelfManage,
          updatedBy: userId
        })
      )
      .eq("id", attribute.id);
  }
);

export const updateAttributeCategory = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAttributeCategory(attributeCategory: {
    id: string;
    name: string;
    emoji?: string;
    public: boolean;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { id, ...update } = attributeCategory;
    return client
      .from("userAttributeCategory")
      .update(sanitize(update))
      .eq("id", id);
  }
);

export const updateAttributeSortOrder = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateAttributeSortOrder(
    updates: {
      id: string;
      sortOrder: number;
      updatedBy: string;
    }[]
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const updatePromises = updates.map(({ id, sortOrder, updatedBy }) =>
      client.from("userAttribute").update({ sortOrder, updatedBy }).eq("id", id)
    );
    return Promise.all(updatePromises);
  }
);

export const updateEmployeeJob = mcpTool(
  {
    classification: "WRITE"
  },
  async function updateEmployeeJob(
    employeeId: string,
    employeeJob: z.infer<typeof employeeJobValidator> & {
      companyId: string;
      updatedBy: string;
      customFields?: Json;
    }
  ) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("employeeJob")
      .update(sanitize(employeeJob))
      .eq("id", employeeId)
      .eq("companyId", companyId);
  }
);

export const upsertDepartment = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertDepartment(
    department:
      | (Omit<z.infer<typeof departmentValidator>, "id"> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof departmentValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("id" in department) {
      return client
        .from("department")
        .update(sanitize(department))
        .eq("id", department.id);
    }
    return client.from("department").insert(department).select("*").single();
  }
);

export const upsertHoliday = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertHoliday(
    holiday:
      | (Omit<z.infer<typeof holidayValidator>, "id"> & {
          companyId: string;
          createdBy: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof holidayValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in holiday) {
      return client.from("holiday").insert(holiday).select("*").single();
    }
    return client
      .from("holiday")
      .update(sanitize(holiday))
      .eq("id", holiday.id);
  }
);

export const upsertShift = mcpTool(
  {
    classification: "WRITE"
  },
  async function upsertShift(
    shift:
      | (Omit<z.infer<typeof shiftValidator>, "id"> & {
          createdBy: string;
          companyId: string;
          customFields?: Json;
        })
      | (Omit<z.infer<typeof shiftValidator>, "id"> & {
          id: string;
          updatedBy: string;
          customFields?: Json;
        })
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    if ("createdBy" in shift) {
      return client.from("shift").insert([shift]).select("*").single();
    }
    return client.from("shift").update(sanitize(shift)).eq("id", shift.id);
  }
);

export const clockIn = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({ args: z.object({ employeeId: z.string() }) })
  },
  async function clockIn(args: { employeeId: string }) {
    const { companyId, userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    const existing = await getOpenClockEntry(args.employeeId);
    if (existing.data) {
      return { data: null, error: { message: "Already clocked in" } };
    }

    return client.from("timeCardEntry").insert({
      employeeId: args.employeeId,
      companyId: companyId,
      createdBy: userId
    });
  }
);

export const clockOut = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({
        employeeId: z.string(),
        clockOut: z.string().optional(),
        note: z.string().optional()
      })
    })
  },
  async function clockOut(args: {
    employeeId: string;
    clockOut?: string;
    note?: string;
  }) {
    const { userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    const open = await getOpenClockEntry(args.employeeId);
    if (!open.data) {
      return { data: null, error: { message: "Not currently clocked in" } };
    }

    return client
      .from("timeCardEntry")
      .update(
        sanitize({
          clockOut: args.clockOut ?? new Date().toISOString(),
          note: args.note,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
      )
      .eq("id", open.data.id);
  }
);

export const createTimeCardEntry = mcpTool(
  {
    classification: "WRITE"
  },
  async function createTimeCardEntry(entry: {
    employeeId: string;
    clockIn: string;
    clockOut?: string | null;
    note?: string | null;
  }) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId, userId } = AuthContextHolder.get();
    return client
      .from("timeCardEntry")
      .insert(sanitize({ ...entry, companyId, createdBy: userId }))
      .select("id")
      .single();
  }
);

export const deleteTimeCardEntry = mcpTool(
  {
    classification: "DESTRUCTIVE"
  },
  async function deleteTimeCardEntry(entryId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("timeCardEntry").delete().eq("id", entryId);
  }
);

export const getClockedInEmployees = mcpTool(
  {
    classification: "READ"
  },
  async function getClockedInEmployees() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("timeCardEntries")
      .select("*")
      .eq("companyId", companyId)
      .is("clockOut", null)
      .order("clockIn", { ascending: true });
  }
);

export const getOpenClockEntry = mcpTool(
  {
    classification: "READ"
  },
  async function getOpenClockEntry(employeeId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("timeCardEntry")
      .select("*")
      .eq("employeeId", employeeId)
      .eq("companyId", companyId)
      .is("clockOut", null)
      .maybeSingle();
  }
);

export const getRecentTimecards = mcpTool(
  {
    classification: "READ"
  },
  async function getRecentTimecards() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    return client
      .from("timeCardEntries")
      .select("*")
      .eq("companyId", companyId)
      .order("clockIn", { ascending: false })
      .limit(100);
  }
);

export const getScheduledEmployeesToday = mcpTool(
  {
    classification: "READ"
  },
  async function getScheduledEmployeesToday() {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const { data } = await client
      .from("employeeJob")
      .select(
        "id, shiftId, shift:shift(id, name, startTime, endTime, sunday, monday, tuesday, wednesday, thursday, friday, saturday)"
      )
      .eq("companyId", companyId)
      .not("shiftId", "is", null);

    if (!data) return [];

    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday"
    ] as const;
    const today = dayNames[new Date().getDay()];

    return data.filter((ej) => {
      const shift = ej.shift as Record<string, unknown> | null;
      return shift && shift[today] === true;
    });
  }
);

export const getTimeCardEntry = mcpTool(
  {
    classification: "READ"
  },
  async function getTimeCardEntry(entryId: string) {
    const client = getAuthClient<SupabaseClient<Database>>();
    return client.from("timeCardEntry").select("*").eq("id", entryId).single();
  }
);

export const getTimeCardEntries = mcpTool(
  {
    classification: "READ",
    schema: z.object({
      args: z.object({
        employeeId: z.string(),
        from: z.string().optional(),
        to: z.string().optional()
      })
    })
  },
  async function getTimeCardEntries(args: {
    employeeId: string;
    from?: string;
    to?: string;
  }) {
    const { companyId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    let query = client
      .from("timeCardEntry")
      .select("*")
      .eq("employeeId", args.employeeId)
      .eq("companyId", companyId)
      .order("clockIn", { ascending: false });

    if (args.from) {
      query = query.gte("clockIn", args.from);
    }
    if (args.to) {
      query = query.lte("clockIn", args.to);
    }

    return query;
  }
);

export const getTimecardEntries = mcpTool(
  {
    classification: "READ"
  },
  async function getTimecardEntries(
    args: GenericQueryFilters & { search: string | null }
  ) {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    let query = client
      .from("timeCardEntries")
      .select("*", { count: "exact" })
      .eq("companyId", companyId);

    if (args.search) {
      query = query.or(
        `firstName.ilike.%${args.search}%,lastName.ilike.%${args.search}%`
      );
    }

    query = setGenericQueryFilters(query, args, [
      { column: "clockIn", ascending: false }
    ]);

    return query;
  }
);

export const getWeeklyHoursForEmployees = mcpTool(
  {
    classification: "READ"
  },
  async function getWeeklyHoursForEmployees(
    employeeIds: string[]
  ): Promise<Record<string, number>> {
    const client = getAuthClient<SupabaseClient<Database>>();
    const { companyId } = AuthContextHolder.get();
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);

    const { data: entries } = await client
      .from("timeCardEntry")
      .select("employeeId, clockIn, clockOut")
      .eq("companyId", companyId)
      .in("employeeId", employeeIds)
      .gte("clockIn", monday.toISOString());

    const weeklyMs: Record<string, number> = {};
    for (const entry of entries ?? []) {
      const end = entry.clockOut
        ? new Date(entry.clockOut).getTime()
        : Date.now();
      const ms = end - new Date(entry.clockIn).getTime();
      weeklyMs[entry.employeeId] = (weeklyMs[entry.employeeId] ?? 0) + ms;
    }

    return weeklyMs;
  }
);

export const updateTimeCardEntry = mcpTool(
  {
    classification: "WRITE",
    schema: z.object({
      args: z.object({
        entryId: z.string(),
        clockIn: z.string().optional(),
        clockOut: z.string().nullable().optional(),
        note: z.string().nullable().optional()
      })
    })
  },
  async function updateTimeCardEntry(args: {
    entryId: string;
    clockIn?: string;
    clockOut?: string | null;
    note?: string | null;
  }) {
    const { userId } = AuthContextHolder.get();
    const client = getAuthClient<SupabaseClient<Database>>();
    return client
      .from("timeCardEntry")
      .update(
        sanitize({
          clockIn: args.clockIn,
          clockOut: args.clockOut,
          note: args.note,
          updatedBy: userId,
          updatedAt: new Date().toISOString()
        })
      )
      .eq("id", args.entryId);
  }
);
