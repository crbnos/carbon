import { error, getCarbonServiceRole, success } from "@carbon/auth";
import { deleteAuthAccount } from "@carbon/auth/auth.server";
import { flash, requireAuthSession } from "@carbon/auth/session.server";
import type { Database, Json } from "@carbon/database";
import { redis } from "@carbon/kv";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "@vercel/remix";
import { getSupplierContact } from "~/modules/purchasing";
import { getCustomerContact } from "~/modules/sales";
import type {
  CompanyPermission,
  EmployeeInsert,
  EmployeeTypePermission,
  InviteInsert,
  Module,
  Permission,
  User,
} from "~/modules/users";
import { getPermissionsByEmployeeType } from "~/modules/users";
import type { Result } from "~/types";
import { path } from "~/utils/path";
import { insertEmployeeJob } from "../people/people.service";

export async function acceptInvite(
  serviceRole: SupabaseClient<Database>,
  code: string,
  email?: string
) {
  const invite = await serviceRole
    .from("invite")
    .select("*")
    .eq("code", code)
    .is("acceptedAt", null)
    .single();

  if (invite.error) return invite;

  if (email && invite.data.email !== email) {
    throw new Error(
      "Invite code does not match email. Please logout and try again."
    );
  }

  const user = await getUserByEmail(invite.data.email);
  if (user.error) return user;

  const activationFunction =
    invite.data.role === "employee"
      ? activateEmployee
      : invite.data.role === "customer"
      ? activateCustomer
      : invite.data.role === "supplier"
      ? activateSupplier
      : null;

  if (!activationFunction) {
    return {
      data: null,
      error: {
        message: "Invalid invite role",
      },
    };
  }

  const [activate, addUser, setPermissions] = await Promise.all([
    activationFunction(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId,
    }),
    addUserToCompany(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId,
      role: invite.data.role,
    }),
    setUserPermissions(
      serviceRole,
      user.data.id,
      invite.data.permissions as Record<string, string[]>
    ),
  ]);

  if (activate.error) {
    console.error(activate.error);
    await rollbackInvite(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId,
    });
    return activate;
  }

  if (addUser.error) {
    console.error(addUser.error);
    await rollbackInvite(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId,
    });
    return addUser;
  }

  if (setPermissions.error) {
    console.error(setPermissions.error);
    await rollbackInvite(serviceRole, {
      userId: user.data.id,
      companyId: invite.data.companyId,
    });
    return setPermissions;
  }

  return serviceRole
    .from("invite")
    .update({ acceptedAt: new Date().toISOString() })
    .eq("code", code)
    .select("*")
    .single();
}

async function activateCustomer(
  client: SupabaseClient<Database>,
  {
    userId,
    companyId,
  }: {
    userId: string;
    companyId: string;
  }
) {
  return client
    .from("customerAccount")
    .update({ active: true })
    .eq("id", userId)
    .eq("companyId", companyId);
}

async function activateEmployee(
  client: SupabaseClient<Database>,
  {
    userId,
    companyId,
  }: {
    userId: string;
    companyId: string;
  }
) {
  return client
    .from("employee")
    .update({ active: true })
    .eq("id", userId)
    .eq("companyId", companyId);
}

async function activateSupplier(
  client: SupabaseClient<Database>,
  {
    userId,
    companyId,
  }: {
    userId: string;
    companyId: string;
  }
) {
  return client
    .from("supplierAccount")
    .update({ active: true })
    .eq("id", userId)
    .eq("companyId", companyId);
}

export async function addUserToCompany(
  client: SupabaseClient<Database>,
  userToCompany: {
    userId: string;
    companyId: string;
    role: "employee" | "customer" | "supplier";
  }
) {
  return client.from("userToCompany").insert(userToCompany);
}

export async function createCustomerAccount(
  client: SupabaseClient<Database>,
  {
    id,
    customerId,
    companyId,
    createdBy,
  }: {
    id: string;
    customerId: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | { success: false; message: string }
  | { success: true; code: string; userId: string; email: string }
> {
  const customerContact = await getCustomerContact(client, id);
  if (
    customerContact.error ||
    customerContact.data === null ||
    customerContact.data.contact === null
  ) {
    return { success: false, message: "Failed to get customer contact" };
  }

  const { email, firstName, lastName } = customerContact.data.contact;

  const permissions = makeCustomerPermissions(companyId);
  const serviceRole = getCarbonServiceRole();
  const user = await getUserByEmail(email);
  let userId = "";
  let isNewUser = false;

  if (user.data) {
    userId = user.data.id;
  } else {
    isNewUser = true;
    const createSupabaseUser = await serviceRole.auth.admin.createUser({
      email: email.toLowerCase(),
      password: crypto.randomUUID(),
      email_confirm: true,
    });

    if (createSupabaseUser.error) {
      return { success: false, message: createSupabaseUser.error.message };
    }

    userId = createSupabaseUser.data.user.id;
    const createCarbonUser = await createUser(serviceRole, {
      id: userId,
      email: email.toLowerCase(),
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      avatarUrl: null,
    });

    if (createCarbonUser.error) {
      await deleteAuthAccount(serviceRole, userId);
      return { success: false, message: createCarbonUser.error.message };
    }
  }

  const code = crypto.randomUUID();
  const [contactUpdate, customerAccountInsert, inviteInsert] =
    await Promise.all([
      client.from("customerContact").update({ userId }).eq("id", id),
      insertCustomerAccount(client, {
        id: userId,
        customerId,
        companyId,
      }),
      insertInvite(serviceRole, {
        role: "customer",
        permissions,
        email,
        companyId,
        createdBy,
        code,
      }),
    ]);

  if (contactUpdate.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateCustomer(serviceRole, userId, companyId);
    }
    return { success: false, message: contactUpdate.error.message };
  }

  if (customerAccountInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateCustomer(serviceRole, userId, companyId);
    }
    return { success: false, message: customerAccountInsert.error.message };
  }

  if (inviteInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateCustomer(serviceRole, userId, companyId);
    }
    return { success: false, message: inviteInsert.error.message };
  }

  return { success: true, code, userId, email };
}

export async function createEmployeeAccount(
  client: SupabaseClient<Database>,
  {
    email,
    firstName,
    lastName,
    employeeType,
    locationId,
    companyId,
    createdBy,
  }: {
    email: string;
    firstName: string;
    lastName: string;
    employeeType: string;
    locationId: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | { success: false; message: string }
  | { success: true; code: string; userId: string }
> {
  const employeeTypePermissions = await getPermissionsByEmployeeType(
    client,
    employeeType
  );
  if (employeeTypePermissions.error) {
    return { success: false, message: employeeTypePermissions.error.message };
  }

  const permissions = makePermissionsFromEmployeeType(employeeTypePermissions);
  const serviceRole = getCarbonServiceRole();
  const user = await getUserByEmail(email);
  let userId = "";
  let isNewUser = false;

  if (user.data) {
    userId = user.data.id;
  } else {
    isNewUser = true;
    const createSupabaseUser = await serviceRole.auth.admin.createUser({
      email: email.toLowerCase(),
      password: crypto.randomUUID(),
      email_confirm: true,
    });

    if (createSupabaseUser.error) {
      return { success: false, message: createSupabaseUser.error.message };
    }

    userId = createSupabaseUser.data.user.id;
    const createCarbonUser = await createUser(serviceRole, {
      id: userId,
      email: email.toLowerCase(),
      firstName,
      lastName,
      avatarUrl: null,
    });

    if (createCarbonUser.error) {
      await deleteAuthAccount(serviceRole, userId);
      return { success: false, message: createCarbonUser.error.message };
    }
  }

  const code = crypto.randomUUID();
  const [employeeInsert, jobInsert, inviteInsert] = await Promise.all([
    insertEmployee(client, {
      id: userId,
      employeeTypeId: employeeType,
      active: false,
      companyId,
    }),
    insertEmployeeJob(client, {
      id: userId,
      companyId,
      locationId,
    }),
    insertInvite(serviceRole, {
      role: "employee",
      permissions,
      email,
      companyId,
      createdBy,
      code,
    }),
  ]);

  if (employeeInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateEmployee(serviceRole, userId, companyId);
    }
    return { success: false, message: employeeInsert.error.message };
  }

  if (jobInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateEmployee(serviceRole, userId, companyId);
    }
    return { success: false, message: jobInsert.error.message };
  }

  if (inviteInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateEmployee(serviceRole, userId, companyId);
    }
    return { success: false, message: inviteInsert.error.message };
  }

  return { success: true, code, userId };
}

export async function createSupplierAccount(
  client: SupabaseClient<Database>,
  {
    id,
    supplierId,
    companyId,
    createdBy,
  }: {
    id: string;
    supplierId: string;
    companyId: string;
    createdBy: string;
  }
): Promise<
  | { success: false; message: string }
  | { success: true; code: string; userId: string; email: string }
> {
  const supplierContact = await getSupplierContact(client, id);
  if (
    supplierContact.error ||
    supplierContact.data === null ||
    supplierContact.data.contact === null
  ) {
    return { success: false, message: "Failed to get supplier contact" };
  }

  const { email, firstName, lastName } = supplierContact.data.contact;

  const permissions = makeSupplierPermissions(companyId);
  const serviceRole = getCarbonServiceRole();
  const user = await getUserByEmail(email);
  let userId = "";
  let isNewUser = false;

  if (user.data) {
    userId = user.data.id;
  } else {
    isNewUser = true;
    const createSupabaseUser = await serviceRole.auth.admin.createUser({
      email: email.toLowerCase(),
      password: crypto.randomUUID(),
      email_confirm: true,
    });

    if (createSupabaseUser.error) {
      return { success: false, message: createSupabaseUser.error.message };
    }

    userId = createSupabaseUser.data.user.id;
    const createCarbonUser = await createUser(serviceRole, {
      id: userId,
      email: email.toLowerCase(),
      firstName: firstName ?? "",
      lastName: lastName ?? "",
      avatarUrl: null,
    });

    if (createCarbonUser.error) {
      await deleteAuthAccount(serviceRole, userId);
      return { success: false, message: createCarbonUser.error.message };
    }
  }

  const code = crypto.randomUUID();
  const [contactUpdate, supplierAccountInsert, inviteInsert] =
    await Promise.all([
      client.from("supplierContact").update({ userId }).eq("id", id),
      insertSupplierAccount(client, {
        id: userId,
        supplierId,
        companyId,
      }),
      insertInvite(serviceRole, {
        role: "supplier",
        permissions,
        email,
        companyId,
        createdBy,
        code,
      }),
    ]);

  if (contactUpdate.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateSupplier(serviceRole, userId, companyId);
    }
    return { success: false, message: contactUpdate.error.message };
  }

  if (supplierAccountInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateSupplier(serviceRole, userId, companyId);
    }
    return { success: false, message: supplierAccountInsert.error.message };
  }

  if (inviteInsert.error) {
    if (isNewUser) {
      await deleteAuthAccount(serviceRole, userId);
    } else {
      await deactivateSupplier(serviceRole, userId, companyId);
    }
    return { success: false, message: inviteInsert.error.message };
  }

  return { success: true, code, userId, email };
}

async function createUser(
  client: SupabaseClient<Database>,
  user: Omit<User, "fullName">
) {
  const { data, error } = await insertUser(client, user);

  if (error) {
    await deleteAuthAccount(client, user.id);
  }

  return { data, error };
}

export async function deactivateCustomer(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Result> {
  const currentPermissions = await serviceRole
    .from("userPermission")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (currentPermissions.error) {
    return error(currentPermissions.error, "Failed to get user permissions");
  }

  const permissions = Object.entries(
    (currentPermissions.data?.permissions ?? {}) as Record<string, string[]>
  ).reduce<Record<string, string[]>>((acc, [key, value]) => {
    acc[key] = value.filter((id) => id !== companyId);
    return acc;
  }, {});

  const [updatePermissions, userToCompanyDelete, customerAccountDelete] =
    await Promise.all([
      serviceRole
        .from("userPermission")
        .update({ permissions })
        .eq("id", userId),
      serviceRole
        .from("userToCompany")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("customerAccount")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("search")
        .delete()
        .eq("uuid", userId)
        .eq("companyId", companyId),
    ]);

  if (updatePermissions.error) {
    return error(updatePermissions.error, "Failed to update user permissions");
  }

  if (userToCompanyDelete.error) {
    return error(
      userToCompanyDelete.error,
      "Failed to remove user from company"
    );
  }

  if (customerAccountDelete.error) {
    return error(
      customerAccountDelete.error,
      "Failed to remove customer account"
    );
  }

  return success("Sucessfully deactivated customer");
}

export async function deactivateEmployee(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Result> {
  const currentPermissions = await serviceRole
    .from("userPermission")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (currentPermissions.error) {
    return error(currentPermissions.error, "Failed to get user permissions");
  }

  const permissions = Object.entries(
    (currentPermissions.data?.permissions ?? {}) as Record<string, string[]>
  ).reduce<Record<string, string[]>>((acc, [key, value]) => {
    acc[key] = value.filter((id) => id !== companyId);
    return acc;
  }, {});

  const [updatePermissions, userToCompanyDelete, employeeDelete] =
    await Promise.all([
      serviceRole
        .from("userPermission")
        .update({ permissions })
        .eq("id", userId),
      serviceRole
        .from("userToCompany")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("employee")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("search")
        .delete()
        .eq("uuid", userId)
        .eq("companyId", companyId),
      serviceRole.from("employeeJob").delete().eq("id", userId),
    ]);

  if (updatePermissions.error) {
    return error(updatePermissions.error, "Failed to update user permissions");
  }

  if (userToCompanyDelete.error) {
    return error(
      userToCompanyDelete.error,
      "Failed to remove user from company"
    );
  }

  if (employeeDelete.error) {
    return error(employeeDelete.error, "Failed to remove employee");
  }

  return success("Sucessfully deactivated employee");
}

export async function deactivateUser(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  const userToCompany = await serviceRole
    .from("userToCompany")
    .select("role")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .single();

  if (userToCompany.error) {
    // maybe they are invited but not added to the company yet
    const user = await serviceRole
      .from("user")
      .select("*")
      .eq("id", userId)
      .single();
    if (user.error) {
      return error(user.error, "Failed to get user");
    }

    const invite = await serviceRole
      .from("invite")
      .select("*")
      .eq("email", user.data?.email)
      .eq("companyId", companyId)
      .single();
    if (invite.error) {
      return error(invite.error, "Failed to get invite");
    }

    if (invite.data?.role === "customer") {
      return deactivateCustomer(serviceRole, userId, companyId);
    } else if (invite.data?.role === "employee") {
      return deactivateEmployee(serviceRole, userId, companyId);
    } else if (invite.data?.role === "supplier") {
      return deactivateSupplier(serviceRole, userId, companyId);
    } else {
      throw new Error("Invalid user role");
    }
  }

  if (userToCompany.data?.role === "customer") {
    return deactivateCustomer(serviceRole, userId, companyId);
  } else if (userToCompany.data?.role === "employee") {
    return deactivateEmployee(serviceRole, userId, companyId);
  } else if (userToCompany.data?.role === "supplier") {
    return deactivateSupplier(serviceRole, userId, companyId);
  } else {
    throw new Error("Invalid user role");
  }
}

export async function deactivateSupplier(
  serviceRole: SupabaseClient<Database>,
  userId: string,
  companyId: string
): Promise<Result> {
  const currentPermissions = await serviceRole
    .from("userPermission")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (currentPermissions.error) {
    return error(currentPermissions.error, "Failed to get user permissions");
  }

  const permissions = Object.entries(
    (currentPermissions.data?.permissions ?? {}) as Record<string, string[]>
  ).reduce<Record<string, string[]>>((acc, [key, value]) => {
    acc[key] = value.filter((id) => id !== companyId);
    return acc;
  }, {});

  const [updatePermissions, userToCompanyDelete, supplierAccountDelete] =
    await Promise.all([
      serviceRole
        .from("userPermission")
        .update({ permissions })
        .eq("id", userId),
      serviceRole
        .from("userToCompany")
        .delete()
        .eq("userId", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("supplierAccount")
        .delete()
        .eq("id", userId)
        .eq("companyId", companyId),
      serviceRole
        .from("search")
        .delete()
        .eq("uuid", userId)
        .eq("companyId", companyId),
    ]);

  if (updatePermissions.error) {
    return error(updatePermissions.error, "Failed to update user permissions");
  }

  if (userToCompanyDelete.error) {
    return error(
      userToCompanyDelete.error,
      "Failed to remove user from company"
    );
  }

  if (supplierAccountDelete.error) {
    return error(
      supplierAccountDelete.error,
      "Failed to remove supplier account"
    );
  }

  return success("Sucessfully deactivated supplier");
}

export async function getClaims(
  client: SupabaseClient<Database>,
  uid: string,
  company?: string
) {
  return client.rpc("get_claims", { uid, company: company ?? "" });
}

export async function getCurrentUser(
  request: Request,
  client: SupabaseClient<Database>
) {
  const { userId } = await requireAuthSession(request);

  const user = await getUser(client, userId);
  if (user?.error || user?.data === null) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(user.error, "Failed to get user"))
    );
  }

  return user.data;
}

export function getPermissionCacheKey(userId: string) {
  return `permissions:${userId}`;
}

export async function getUser(client: SupabaseClient<Database>, id: string) {
  return client
    .from("user")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
}

export async function getUserByEmail(email: string) {
  return getCarbonServiceRole()
    .from("user")
    .select("*")
    .eq("email", email.toLowerCase())
    .single();
}

export async function getUserClaims(userId: string, companyId: string) {
  let claims: {
    permissions: Record<string, Permission>;
    role: string | null;
  } | null = null;

  try {
    claims = JSON.parse(
      (await redis.get(getPermissionCacheKey(userId))) || "null"
    );
  } finally {
    // if we don't have permissions from redis, get them from the database
    if (!claims) {
      // TODO: remove service role from here, and move it up a level
      const rawClaims = await getClaims(
        getCarbonServiceRole(),
        userId,
        companyId
      );
      if (rawClaims.error || rawClaims.data === null) {
        console.error(rawClaims);
        throw new Error("Failed to get claims");
      }

      // convert rawClaims to permissions
      claims = makePermissionsFromClaims(rawClaims.data as Json[]);

      // store claims in redis
      await redis.set(getPermissionCacheKey(userId), JSON.stringify(claims));

      if (!claims) {
        throw new Error("Failed to get claims");
      }
    }

    return claims;
  }
}

export async function getUserGroups(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client.rpc("groups_for_user", { uid: userId });
}

export async function getUserDefaults(
  client: SupabaseClient<Database>,
  userId: string,
  companyId: string
) {
  return client
    .from("userDefaults")
    .select("*")
    .eq("userId", userId)
    .eq("companyId", companyId)
    .maybeSingle();
}

async function insertCustomerAccount(
  client: SupabaseClient<Database>,
  customerAccount: {
    id: string;
    customerId: string;
    companyId: string;
  }
) {
  return client
    .from("customerAccount")
    .insert(customerAccount)
    .select("id")
    .single();
}

export async function insertEmployee(
  client: SupabaseClient<Database>,
  employee: EmployeeInsert
) {
  return client.from("employee").insert([employee]).select("*").single();
}

export async function insertInvite(
  client: SupabaseClient<Database>,
  invite: InviteInsert
) {
  return client
    .from("invite")
    .upsert([{ ...invite, acceptedAt: null }], {
      onConflict: "email, companyId",
      ignoreDuplicates: false,
    })
    .select("*")
    .single();
}

async function insertSupplierAccount(
  client: SupabaseClient<Database>,
  supplierAccount: {
    id: string;
    supplierId: string;
    companyId: string;
  }
) {
  return client
    .from("supplierAccount")
    .insert(supplierAccount)
    .select("id")
    .single();
}

async function insertUser(
  client: SupabaseClient<Database>,
  user: Omit<User, "fullName" | "createdAt">
) {
  return client.from("user").insert([user]).select("*");
}

function makePermissionsFromEmployeeType({
  data,
}: {
  data: {
    view: string[];
    create: string[];
    update: string[];
    delete: string[];
    module: string;
  }[];
}) {
  const permissions: Record<string, string[]> = {};

  data.forEach((permission) => {
    if (!permission.module) {
      throw new Error(
        `Permission module is missing for permission ${JSON.stringify(data)}`
      );
    }

    const module = permission.module.toLowerCase();

    permissions[`${module}_view`] = permission.view;
    permissions[`${module}_create`] = permission.create;
    permissions[`${module}_update`] = permission.update;
    permissions[`${module}_delete`] = permission.delete;
  });

  return permissions;
}

function isClaimPermission(key: string, value: unknown) {
  const action = key.split("_")[1];
  return (
    action !== undefined &&
    ["view", "create", "update", "delete"].includes(action) &&
    Array.isArray(value)
  );
}

function makeCustomerPermissions(companyId: string) {
  // TODO: this should be more dynamic
  const permissions: Record<string, string[]> = {
    documents_view: [companyId],
    documents_create: [companyId],
    documents_udpate: [companyId],
    documents_delete: [companyId],
    jobs_view: [companyId],
    sales_view: [companyId],
    parts_view: [companyId],
  };

  return permissions;
}

export function makeEmptyPermissionsFromModules(data: Module[]) {
  return data.reduce<
    Record<string, { name: string; permission: CompanyPermission }>
  >((acc, m) => {
    if (m.name) {
      acc[m.name] = {
        name: m.name.toLowerCase(),
        permission: {
          view: false,
          create: false,
          update: false,
          delete: false,
        },
      };
    }
    return acc;
  }, {});
}

export function makeCompanyPermissionsFromClaims(
  claims: Json[] | null,
  companyId: string
) {
  if (typeof claims !== "object" || claims === null) return null;
  let permissions: Record<string, CompanyPermission> = {};
  let role: string | null = null;

  Object.entries(claims).forEach(([key, value]) => {
    if (isClaimPermission(key, value)) {
      const [module, action] = key.split("_");
      if (!(module in permissions)) {
        permissions[module] = {
          view: false,
          create: false,
          update: false,
          delete: false,
        };
      }

      if (!Array.isArray(value)) {
        permissions[module] = {
          view: false,
          create: false,
          update: false,
          delete: false,
        };
      } else {
        switch (action) {
          case "view":
            permissions[module]["view"] =
              value.includes("0") || value.includes(companyId);
            break;
          case "create":
            permissions[module]["create"] =
              value.includes("0") || value.includes(companyId);
            break;
          case "update":
            permissions[module]["update"] =
              value.includes("0") || value.includes(companyId);
            break;
          case "delete":
            permissions[module]["delete"] =
              value.includes("0") || value.includes(companyId);
            break;
        }
      }
    }
  });

  if ("role" in claims) {
    role = claims["role"] as string;
  }

  if ("items" in permissions) {
    delete permissions["items"];
  }

  return { permissions, role };
}

export function makePermissionsFromClaims(claims: Json[] | null) {
  if (typeof claims !== "object" || claims === null) return null;
  let permissions: Record<string, Permission> = {};
  let role: string | null = null;

  Object.entries(claims).forEach(([key, value]) => {
    if (isClaimPermission(key, value)) {
      const [module, action] = key.split("_");
      if (!(module in permissions)) {
        permissions[module] = {
          view: [],
          create: [],
          update: [],
          delete: [],
        };
      }

      switch (action) {
        case "view":
          permissions[module]["view"] = value as string[];
          break;
        case "create":
          permissions[module]["create"] = value as string[];
          break;
        case "update":
          permissions[module]["update"] = value as string[];
          break;
        case "delete":
          permissions[module]["delete"] = value as string[];
          break;
      }
    }
  });

  if ("role" in claims) {
    role = claims["role"] as string;
  }

  if ("items" in permissions) {
    delete permissions["items"];
  }

  return { permissions, role };
}

export function makeCompanyPermissionsFromEmployeeType(
  data: EmployeeTypePermission[],
  companyId: string
) {
  const result: Record<
    string,
    { name: string; permission: CompanyPermission }
  > = {};
  if (!data) return result;
  data.forEach((permission) => {
    if (!permission.module) {
      throw new Error(
        `Module is missing for permission ${JSON.stringify(permission)}`
      );
    } else {
      result[permission.module] = {
        name: permission.module.toLowerCase(),
        permission: {
          view:
            permission.view.includes("0") ||
            permission.view.includes(companyId),
          create:
            permission.create.includes("0") ||
            permission.create.includes(companyId),
          update:
            permission.update.includes("0") ||
            permission.update.includes(companyId),
          delete:
            permission.delete.includes("0") ||
            permission.delete.includes(companyId),
        },
      };
    }
  });

  if ("items" in result) {
    delete result["items"];
  }

  return result;
}

function makeSupplierPermissions(companyId: string) {
  // TODO: this should be more dynamic
  const permissions: Record<string, string[]> = {
    documents_view: [companyId],
    documents_create: [companyId],
    documents_udpate: [companyId],
    documents_delete: [companyId],
    purchasing_view: [companyId],
    parts_view: [companyId],
  };

  return permissions;
}

export async function getInvite(
  client: SupabaseClient<Database>,
  email: string,
  companyId: string
) {
  return client
    .from("invite")
    .select("*")
    .eq("email", email)
    .eq("companyId", companyId)
    .single();
}

export async function resetPassword(userId: string, password: string) {
  return getCarbonServiceRole().auth.admin.updateUserById(userId, {
    password,
  });
}

async function rollbackInvite(
  serviceRole: SupabaseClient<Database>,
  { userId, companyId }: { userId: string; companyId: string }
) {
  await Promise.all([
    serviceRole
      .from("employee")
      .update({ active: false })
      .eq("id", userId)
      .eq("companyId", companyId),
    serviceRole
      .from("userToCompany")
      .delete()
      .eq("userId", userId)
      .eq("companyId", companyId),
    serviceRole
      .from("customerAccount")
      .delete()
      .eq("userId", userId)
      .eq("companyId", companyId),
    serviceRole
      .from("supplierAccount")
      .delete()
      .eq("userId", userId)
      .eq("companyId", companyId),
  ]);
}

async function setUserPermissions(
  client: SupabaseClient<Database>,
  userId: string,
  permissions: Record<string, string[]>
) {
  const user = await client
    .from("userPermission")
    .select("permissions")
    .eq("id", userId)
    .maybeSingle();

  const currentPermissions = (user.data?.permissions ?? {}) as Record<
    string,
    string[]
  >;
  const newPermissions = { ...currentPermissions };

  Object.entries(permissions).forEach(([key, value]) => {
    if (key in newPermissions) {
      newPermissions[key] = [...newPermissions[key], ...value];
    } else {
      newPermissions[key] = value;
    }
  });

  return client
    .from("userPermission")
    .upsert({ id: userId, permissions: newPermissions });
}

export async function updateEmployee(
  client: SupabaseClient<Database>,
  {
    id,
    employeeType,
    permissions,
    companyId,
  }: {
    id: string;
    employeeType: string;
    permissions: Record<string, CompanyPermission>;
    companyId: string;
  }
): Promise<Result> {
  const updateEmployeeEmployeeType = await client
    .from("employee")
    .upsert([{ id, companyId, employeeTypeId: employeeType }]);

  if (updateEmployeeEmployeeType.error)
    return error(updateEmployeeEmployeeType.error, "Failed to update employee");

  return updatePermissions(client, { id, permissions, companyId });
}

export async function updatePermissions(
  client: SupabaseClient<Database>,
  {
    id,
    permissions,
    companyId,
    addOnly = false,
  }: {
    id: string;
    permissions: Record<string, CompanyPermission>;
    companyId: string;
    addOnly?: boolean;
  }
): Promise<Result> {
  if (await client.rpc("is_claims_admin")) {
    const claims = await getClaims(client, id);

    if (claims.error) return error(claims.error, "Failed to get claims");

    const updatedPermissions = (
      typeof claims.data !== "object" ||
      Array.isArray(claims.data) ||
      claims.data === null
        ? {}
        : claims.data
    ) as Record<string, string[]>;
    delete updatedPermissions["role"];

    // add any missing claims to the current claims
    Object.keys(permissions).forEach((name) => {
      const module = name.toLowerCase();
      if (!(`${module}_view` in updatedPermissions)) {
        updatedPermissions[`${module}_view`] = [];
      }
      if (!(`${module}_create` in updatedPermissions)) {
        updatedPermissions[`${module}_create`] = [];
      }
      if (!(`${module}_update` in updatedPermissions)) {
        updatedPermissions[`${module}_update`] = [];
      }
      if (!(`${module}_delete` in updatedPermissions)) {
        updatedPermissions[`${module}_delete`] = [];
      }
    });

    if (addOnly) {
      Object.entries(permissions).forEach(([name, permission]) => {
        const module = name.toLowerCase();
        if (
          permission.view &&
          !updatedPermissions[`${module}_view`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_view`].push(companyId);
        }
        if (
          permission.create &&
          !updatedPermissions[`${module}_create`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_create`].push(companyId);
        }
        if (
          permission.update &&
          !updatedPermissions[`${module}_update`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_update`].push(companyId);
        }
        if (
          permission.delete &&
          !updatedPermissions[`${module}_delete`]?.includes(companyId)
        ) {
          updatedPermissions[`${module}_delete`].push(companyId);
        }
      });
    } else {
      Object.entries(permissions).forEach(([name, permission]) => {
        const module = name.toLowerCase();
        if (permission.view) {
          if (!updatedPermissions[`${module}_view`]?.includes(companyId)) {
            updatedPermissions[`${module}_view`] = [
              ...updatedPermissions[`${module}_view`],
              companyId,
            ];
          }
        } else {
          updatedPermissions[`${module}_view`] = (
            updatedPermissions[`${module}_view`] as string[]
          ).filter((c: string) => c !== companyId);
        }

        if (permission.create) {
          if (!updatedPermissions[`${module}_create`]?.includes(companyId)) {
            updatedPermissions[`${module}_create`] = [
              ...updatedPermissions[`${module}_create`],
              companyId,
            ];
          }
        } else {
          updatedPermissions[`${module}_create`] = (
            updatedPermissions[`${module}_create`] as string[]
          ).filter((c: string) => c !== companyId);
        }

        if (permission.update) {
          if (!updatedPermissions[`${module}_update`]?.includes(companyId)) {
            updatedPermissions[`${module}_update`] = [
              ...updatedPermissions[`${module}_update`],
              companyId,
            ];
          }
        } else {
          updatedPermissions[`${module}_update`] = (
            updatedPermissions[`${module}_update`] as string[]
          ).filter((c: string) => c !== companyId);
        }

        if (permission.delete) {
          if (!updatedPermissions[`${module}_delete`]?.includes(companyId)) {
            updatedPermissions[`${module}_delete`] = [
              ...updatedPermissions[`${module}_delete`],
              companyId,
            ];
          }
        } else {
          updatedPermissions[`${module}_delete`] = (
            updatedPermissions[`${module}_delete`] as string[]
          ).filter((c: string) => c !== companyId);
        }
      });
    }

    const permissionsUpdate = await getCarbonServiceRole()
      .from("userPermission")
      .update({ permissions: updatedPermissions })
      .eq("id", id);
    if (permissionsUpdate.error)
      return error(permissionsUpdate.error, "Failed to update claims");

    await redis.del(getPermissionCacheKey(id));

    return success("Permissions updated");
  } else {
    return error(null, "You do not have permission to update permissions");
  }
}
