import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { updateSubscriptionQuantityForCompany } from "@carbon/stripe/stripe.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { userContext } from "~/context";

export async function action({ request, context }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    create: "users"
  });

  const formData = await request.formData();
  const firstName = (formData.get("firstName") as string)?.trim();
  const lastName = (formData.get("lastName") as string)?.trim();
  const pin = (formData.get("pin") as string)?.trim() || null;

  if (!firstName || !lastName) {
    return data(
      { success: false, message: "First name and last name are required" },
      { status: 400 }
    );
  }

  if (!pin || !/^\d{4}$/.test(pin)) {
    return data(
      {
        success: false,
        message: "PIN is required and must be exactly 4 digits"
      },
      { status: 400 }
    );
  }

  const locationId = context.get(userContext)?.locationId;
  if (!locationId) {
    return data(
      { success: false, message: "No location selected" },
      { status: 400 }
    );
  }

  const serviceRole = await getCarbonServiceRole();
  const operatorId = crypto.randomUUID();
  const syntheticEmail = `${operatorId}@console.internal`;

  // Get the Console Operator employee type
  const operatorType = await serviceRole
    .from("employeeType")
    .select("id")
    .eq("companyId", companyId)
    .eq("systemType", "Console Operator")
    .single();

  if (operatorType.error || !operatorType.data) {
    return data(
      {
        success: false,
        message: "Console Operator employee type not found. Contact an admin."
      },
      { status: 500 }
    );
  }

  const employeeTypeId = operatorType.data.id;

  // 1. Insert user record (no Supabase Auth)
  const userInsert = await serviceRole
    .from("user")
    .insert({
      id: operatorId,
      email: syntheticEmail,
      firstName,
      lastName,
      avatarUrl: null,
      active: true,
      isConsoleOperator: true
    } as any)
    .select("id")
    .single();

  if (userInsert.error) {
    return data(
      { success: false, message: userInsert.error.message },
      { status: 500 }
    );
  }

  // 2. Parallel inserts: employee, employeeJob, userToCompany
  const [employeeInsert, jobInsert, companyInsert] = await Promise.all([
    serviceRole
      .from("employee")
      .insert({
        id: operatorId,
        employeeTypeId,
        active: true,
        companyId,
        pin
      } as any)
      .select("id")
      .single(),
    serviceRole
      .from("employeeJob")
      .insert({
        id: operatorId,
        companyId,
        locationId
      })
      .select("id")
      .single(),
    serviceRole
      .from("userToCompany")
      .insert({ userId: operatorId, companyId, role: "employee" as const })
      .select("userId")
      .single()
  ]);

  // 3. Check each result — rollback user if any failed
  if (employeeInsert.error) {
    await serviceRole.from("user").delete().eq("id", operatorId);
    return data(
      { success: false, message: employeeInsert.error.message },
      { status: 500 }
    );
  }

  if (jobInsert.error) {
    await serviceRole.from("employee").delete().eq("id", operatorId);
    await serviceRole.from("user").delete().eq("id", operatorId);
    return data(
      { success: false, message: jobInsert.error.message },
      { status: 500 }
    );
  }

  if (companyInsert.error) {
    console.error(
      "Failed to link console operator to company:",
      companyInsert.error
    );
  }

  const name = `${firstName} ${lastName}`;

  await updateSubscriptionQuantityForCompany(companyId);

  return data({
    success: true,
    operator: {
      id: operatorId,
      name,
      avatarUrl: null,
      pin
    }
  });
}
