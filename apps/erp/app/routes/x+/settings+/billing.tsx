import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  SelectControlled,
  Submit,
  ValidatedForm,
  validationError,
  validator,
} from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Heading,
  ScrollArea,
  Status,
  VStack,
} from "@carbon/react";
import { useEdition } from "@carbon/remix";
import { getBillingPortalRedirectUrl } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { Form, useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useState } from "react";
import z from "zod";
import { usePermissions, useUser } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Payment",
  to: path.to.billing,
};

const transferOwnershipValidator = z.object({
  intent: z.literal("transfer-ownership"),
  newOwnerId: z.string().min(1, { message: "New owner is required" }),
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
  });

  // Get company plan and usage data for payment section
  const companyPlan = await client
    .from("companyPlan")
    .select(
      `
      *,
      plan:planId (
        name,
        userBasedPricing,
        tasksLimit,
        aiTokensLimit
      )
    `
    )
    .eq("id", companyId)
    .single();

  const companyUsage = await client
    .from("companyUsage")
    .select("*")
    .eq("companyId", companyId)
    .single();

  const userToCompany = await client
    .from("userToCompany")
    .select("userId")
    .eq("companyId", companyId)
    .eq("role", "employee");

  const userIds = userToCompany.data?.map((utc) => utc.userId) || [];

  const employees =
    userIds.length > 0
      ? await client
          .from("user")
          .select(
            `
      id,
      firstName,
      lastName,
      fullName,
      email
    `
          )
          .in("id", userIds)
      : { data: [], error: null };

  return json({
    plan: companyPlan.data,
    usage: companyUsage.data,
    employees: employees.data || [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "billing-portal") {
    try {
      const billingPortalUrl = await getBillingPortalRedirectUrl({ companyId });
      return redirect(billingPortalUrl, 301);
    } catch (err) {
      console.error("Failed to get billing portal URL:", err);
      return json(
        {},
        await flash(request, error("Failed to access billing portal"))
      );
    }
  }

  if (intent === "transfer-ownership") {
    const validation = await validator(transferOwnershipValidator).validate(
      formData
    );
    if (validation.error) {
      return validationError(validation.error);
    }

    const { newOwnerId } = validation.data;

    try {
      const updateResult = await client
        .from("company")
        .update({ ownerId: newOwnerId })
        .eq("id", companyId);

      if (updateResult.error) {
        throw new Error(updateResult.error.message);
      }

      return json(
        {},
        await flash(
          request,
          success("Company ownership has been transferred successfully")
        )
      );
    } catch (err) {
      console.error("Failed to transfer ownership:", err);
      return json(
        {},
        await flash(request, error("Failed to transfer ownership"))
      );
    }
  }

  return json({}, await flash(request, error("Invalid intent")));
}

// This route now only handles actions - UI is in the company route
export default function PaymentSettings() {
  const { plan, usage, employees } = useLoaderData<typeof loader>();
  const { isOwner } = usePermissions();
  const { id: userId } = useUser();
  const edition = useEdition();
  const [ownerId, setOwnerId] = useState<string | null>(userId);

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">Billing</Heading>
        {edition === Edition.Cloud && isOwner() && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Manage Subscription</CardTitle>
                <CardDescription>
                  Manage your subscription and billing information
                </CardDescription>
              </CardHeader>
              <CardContent>
                <VStack spacing={4}>
                  <div className="grid grid-cols-2 gap-4 w-full">
                    <div>
                      <h4 className="font-medium">Plan</h4>
                      <Status color="blue">
                        {plan?.plan?.name || "No active plan"}
                      </Status>
                    </div>
                    <div>
                      <h4 className="font-medium">Status</h4>

                      <SubscriptionStatus
                        status={plan?.stripeSubscriptionStatus || "Unknown"}
                      />
                    </div>
                  </div>

                  {usage && (
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                      <div>
                        <h4 className="font-medium">Users</h4>
                        <p className="text-sm text-muted-foreground">
                          {usage.users} / {plan?.usersLimit || "∞"}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-medium">Tasks</h4>
                        <p className="text-sm text-muted-foreground">
                          {usage.tasks.toLocaleString()} /{" "}
                          {plan?.tasksLimit?.toLocaleString() || "∞"}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-medium">AI Tokens</h4>
                        <p className="text-sm text-muted-foreground">
                          {usage.aiTokens.toLocaleString()} /{" "}
                          {plan?.aiTokensLimit?.toLocaleString() || "∞"}
                        </p>
                      </div>
                    </div>
                  )}
                </VStack>
              </CardContent>
              <CardFooter>
                <Form method="post" action={path.to.billing}>
                  <input type="hidden" name="intent" value="billing-portal" />
                  <Button type="submit">Manage Subscription</Button>
                </Form>
              </CardFooter>
            </Card>

            <ValidatedForm validator={transferOwnershipValidator} method="post">
              <Card>
                <CardHeader>
                  <CardTitle>Manage Ownership</CardTitle>
                  <CardDescription>
                    Transfer ownership of this company to another user
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <VStack spacing={4}>
                    <p className="text-sm text-muted-foreground">
                      As the company owner, you can transfer ownership to
                      another employee. This will give them full access to
                      billing and administrative settings.
                    </p>
                    {employees.length > 0 ? (
                      <>
                        <input
                          type="hidden"
                          name="intent"
                          value="transfer-ownership"
                        />
                        <div className="grid grid-cols-2 gap-4 w-full">
                          <SelectControlled
                            name="newOwnerId"
                            label="New Owner"
                            placeholder="Select a new owner"
                            value={ownerId || undefined}
                            onChange={(value) => {
                              if (value?.value) {
                                setOwnerId(value.value);
                              }
                            }}
                            options={employees.map((employee) => ({
                              label: employee.fullName || employee.email,
                              value: employee.id,
                            }))}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No other employees found. Add employees to enable
                        ownership transfer.
                      </p>
                    )}
                  </VStack>
                </CardContent>
                <CardFooter>
                  <Submit withBlocker={false} isDisabled={ownerId === userId}>
                    Transfer Ownership
                  </Submit>
                </CardFooter>
              </Card>
            </ValidatedForm>
          </>
        )}
      </VStack>
    </ScrollArea>
  );
}

function SubscriptionStatus({ status }: { status: string }) {
  switch (status) {
    case "Active":
      return <Status color="green">Active</Status>;
    case "Inactive":
      return <Status color="orange">Inactive</Status>;
    case "Cancelled":
      return <Status color="red">Cancelled</Status>;
    default:
      return <Status color="gray">Unknown</Status>;
  }
}
