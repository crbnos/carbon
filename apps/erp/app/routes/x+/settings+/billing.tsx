import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  SelectControlled,
  Submit,
  ValidatedForm,
  validationError,
  validator
} from "@carbon/form";
import { getLogger } from "@carbon/logger";
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
  useEdition,
  VStack
} from "@carbon/react";
import { getBillingPortalRedirectUrl } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { usePermissions, useUser } from "~/hooks";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "billing");

export const handle: Handle = {
  breadcrumb: msg`Payment`,
  to: path.to.billing
};

const transferOwnershipValidator = z.object({
  intent: z.literal("transfer-ownership"),
  newOwnerId: z.string().min(1, { message: "New owner is required" })
});

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings"
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

  return {
    plan: companyPlan.data,
    usage: companyUsage.data,
    employees: employees.data || []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      update: "settings"
    }
  );

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "billing-portal") {
    try {
      const plans = await client
        .from("plan")
        .select("stripePriceId")
        .eq("userBasedPricing", true);

      const priceIds = plans.data?.map((plan) => plan.stripePriceId);

      const billingPortalUrl = await getBillingPortalRedirectUrl({
        companyId,
        priceIds
      });
      return redirect(billingPortalUrl, 301);
    } catch (err) {
      logger.error("Failed to get billing portal URL", { error: err });
      return data(
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
        .from("companyGroup")
        .update({ ownerId: newOwnerId })
        .eq("id", companyGroupId);

      if (updateResult.error) {
        throw new Error(updateResult.error.message);
      }

      return data(
        {},
        await flash(
          request,
          success("Company ownership has been transferred successfully")
        )
      );
    } catch (err) {
      logger.error("Failed to transfer ownership", { error: err });
      return data(
        {},
        await flash(request, error("Failed to transfer ownership"))
      );
    }
  }

  return data({}, await flash(request, error("Invalid intent")));
}

// This route now only handles actions - UI is in the company route
export default function PaymentSettings() {
  const { plan, usage, employees } = useLoaderData<typeof loader>();
  const { isOwner } = usePermissions();
  const { id: userId } = useUser();
  const edition = useEdition();
  const [ownerId, setOwnerId] = useState<string | null>(userId);
  const { t } = useLingui();

  return (
    <ScrollArea className="w-full h-[calc(100dvh-49px)]">
      <VStack
        spacing={4}
        className="py-12 px-4 max-w-[60rem] h-full mx-auto gap-4"
      >
        <Heading size="h3">
          <Trans>Billing</Trans>
        </Heading>
        {edition === Edition.Cloud && isOwner() && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  <Trans>Manage Subscription</Trans>
                </CardTitle>
                <CardDescription>
                  <Trans>
                    Manage your subscription and billing information
                  </Trans>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <VStack spacing={4}>
                  <div className="grid grid-cols-2 gap-4 w-full">
                    <div>
                      <h4 className="font-medium">
                        <Trans>Plan</Trans>
                      </h4>
                      <Status color="blue">
                        {plan?.plan?.name || t`No active plan`}
                      </Status>
                    </div>
                    <div>
                      <h4 className="font-medium">
                        <Trans>Status</Trans>
                      </h4>

                      <SubscriptionStatus
                        status={plan?.stripeSubscriptionStatus || "Unknown"}
                      />
                    </div>
                  </div>

                  {usage && (
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t">
                      <div>
                        <h4 className="font-medium">
                          <Trans>Users</Trans>
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {usage.users} / {plan?.usersLimit || "∞"}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-medium">
                          <Trans>Tasks</Trans>
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          {usage.tasks.toLocaleString()} /{" "}
                          {plan?.tasksLimit?.toLocaleString() || "∞"}
                        </p>
                      </div>
                      <div>
                        <h4 className="font-medium">
                          <Trans>AI Tokens</Trans>
                        </h4>
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
                  <Button type="submit">
                    <Trans>Manage Subscription</Trans>
                  </Button>
                </Form>
              </CardFooter>
            </Card>

            <ValidatedForm validator={transferOwnershipValidator} method="post">
              <Card>
                <CardHeader>
                  <CardTitle>
                    <Trans>Manage Ownership</Trans>
                  </CardTitle>
                  <CardDescription>
                    <Trans>
                      Transfer ownership of this company to another user
                    </Trans>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <VStack spacing={4}>
                    <p className="text-sm text-muted-foreground">
                      <Trans>
                        As the company owner, you can transfer ownership to
                        another employee. This will give them full access to
                        billing and administrative settings.
                      </Trans>
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
                            label={t`New Owner`}
                            placeholder={t`Select a new owner`}
                            value={ownerId || undefined}
                            onChange={(value) => {
                              if (value?.value) {
                                setOwnerId(value.value);
                              }
                            }}
                            options={employees.map((employee) => ({
                              label: employee.fullName || employee.email,
                              value: employee.id
                            }))}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        <Trans>
                          No other employees found. Add employees to enable
                          ownership transfer.
                        </Trans>
                      </p>
                    )}
                  </VStack>
                </CardContent>
                <CardFooter>
                  <Submit withBlocker={false} isDisabled={ownerId === userId}>
                    <Trans>Transfer Ownership</Trans>
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
      return (
        <Status color="green">
          <Trans>Active</Trans>
        </Status>
      );
    case "Inactive":
      return (
        <Status color="orange">
          <Trans>Inactive</Trans>
        </Status>
      );
    case "Cancelled":
      return (
        <Status color="red">
          <Trans>Cancelled</Trans>
        </Status>
      );
    default:
      return (
        <Status color="gray">
          <Trans>Unknown</Trans>
        </Status>
      );
  }
}
