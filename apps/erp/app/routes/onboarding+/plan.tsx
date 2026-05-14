import { CarbonEdition, getUser } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cn,
  IconButton,
  VStack
} from "@carbon/react";
import { getCheckoutUrl } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import { useMemo } from "react";
import { LuGraduationCap, LuMoveLeft, LuPhoneCall } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useFetcher, useLoaderData } from "react-router";
import { getCompany, getPlans } from "~/modules/settings";
import { path } from "~/utils/path";

function usePlans() {
  const { t } = useLingui();
  return {
    STARTER: {
      price: 40,
      userMinimum: 0,
      talkToSales: false,
      description: t`Perfect for low-cost evaluation`,
      features: [
        t`ERP, MES, QMS`,
        t`Cloud-Hosted`,
        t`Self-Onboarding with Carbon Academy`
      ]
    },
    BUSINESS: {
      price: 100,
      userMinimum: 5,
      talkToSales: true,
      description: t`For growing businesses that need support`,
      features: [
        t`5 User Minimum`,
        t`Everything from Starter`,
        t`API and Webhooks`,
        t`Implementation Support`,
        t`Unlimited Functional Support`
      ]
    },
    GOVCLOUD: {
      price: 100,
      userMinimum: 5,
      talkToSales: true,
      description: t`For US companies handling ITAR data`,
      features: [
        t`5 User Minimum`,
        t`ERP, MES, QMS`,
        t`Cloud-Hosted`,
        t`API and Webhooks`,
        t`Implementation Support`,
        t`Unlimited Functional Support`
      ]
    }
  };
}

export async function loader({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  if (CarbonEdition !== Edition.Cloud) {
    throw redirect(path.to.authenticatedRoot);
  }

  const plans = await getPlans(client);

  if (!companyId) {
    throw redirect(path.to.onboarding.company);
  }

  if (plans.error || !plans.data) {
    throw new Error("Failed to load plans");
  }

  return { plans: plans.data?.filter((p) => p.public), companyId };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const formData = await request.formData();
  const planId = String(formData.get("planId"));

  if (!planId) {
    throw new Error("Plan ID is required");
  }

  const validPlanIds = ["STARTER", "BUSINESS", "GOVCLOUD"];
  if (!validPlanIds.includes(planId) || planId.startsWith("PARTNER")) {
    throw new Error("Invalid plan ID");
  }

  const [user, company] = await Promise.all([
    getUser(client, userId),
    getCompany(client, companyId)
  ]);

  if (!user.data) {
    throw new Error("User not found");
  }

  if (!company.data) {
    throw new Error("Company not found");
  }

  const url = await getCheckoutUrl({
    planId,
    userId,
    companyId,
    name: company.data?.name,
    email: user.data?.email
  });

  throw redirect(url);
}

export default function OnboardingPlan() {
  const { t } = useLingui();
  const PLANS = usePlans();
  const { plans, companyId } = useLoaderData<typeof loader>();
  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }),
    [locale]
  );

  console.log({ companyId });
  const fetcher = useFetcher<typeof action>();

  return (
    <>
      <div className="flex flex-col max-w-2xl w-full min-h-screen md:min-h-0">
        <div className="sticky top-0 bg-background z-10 pb-4">
          <CardHeader>
            <CardTitle>
              <Trans>Select a plan</Trans>
            </CardTitle>
            <CardDescription>
              {t`Select a plan to get started. You won't be charged for the first ${plans[0].stripeTrialPeriodDays} days. Switch or cancel anytime.`}
            </CardDescription>
          </CardHeader>
        </div>

        <div className="flex-1">
          <div
            className={cn(
              "grid gap-6",
              plans.length === 1
                ? "grid-cols-1 justify-center"
                : "grid-cols-1 md:grid-cols-2"
            )}
          >
            {plans
              .sort((a, b) => {
                const priceA = PLANS[a.id as keyof typeof PLANS]?.price || 0;
                const priceB = PLANS[b.id as keyof typeof PLANS]?.price || 0;
                return priceA - priceB;
              })
              .map((plan) => {
                const planDetails = PLANS[plan.id as keyof typeof PLANS];

                return (
                  <Card key={plan.id} className="relative">
                    <CardHeader>
                      <CardTitle>{plan.name}</CardTitle>
                      <CardDescription>
                        {planDetails?.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-baseline">
                        <span className="text-5xl font-bold tracking-tighter">
                          {formatter.format(planDetails?.price)}
                        </span>
                        <span className="ml-1 text-sm text-muted-foreground tracking-tighter">
                          <Trans>/month/user</Trans>
                        </span>
                      </div>
                      <ul className="mt-6 space-y-3">
                        {planDetails?.features.map((feature, index) => (
                          <li
                            key={index}
                            className="flex items-center justify-start gap-2"
                          >
                            <span className="text-sm">{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                    <CardFooter>
                      <VStack className="w-full">
                        <fetcher.Form method="post" className="w-full">
                          <input type="hidden" name="planId" value={plan.id} />
                          <Button
                            className="w-full"
                            variant="primary"
                            type="submit"
                            isDisabled={fetcher.state !== "idle"}
                            isLoading={
                              fetcher.state !== "idle" &&
                              fetcher.formData?.get("planId") === plan.id
                            }
                          >
                            {plan.stripeTrialPeriodDays > 0
                              ? t`Start ${plan.stripeTrialPeriodDays} Day Free Trial`
                              : t`Start Now`}
                          </Button>
                        </fetcher.Form>

                        {planDetails?.talkToSales ? (
                          <Button
                            leftIcon={<LuPhoneCall />}
                            className="w-full"
                            variant="secondary"
                            asChild
                          >
                            <a
                              href="https://carbon.ms/sales"
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Trans>Talk to Sales</Trans>
                            </a>
                          </Button>
                        ) : (
                          <Button
                            leftIcon={<LuGraduationCap />}
                            className="w-full"
                            variant="secondary"
                            asChild
                          >
                            <a
                              href="https://learn.carbon.ms"
                              target="_blank"
                              rel="noreferrer"
                            >
                              <Trans>Start Learning</Trans>
                            </a>
                          </Button>
                        )}
                      </VStack>
                    </CardFooter>
                  </Card>
                );
              })}
          </div>
        </div>
      </div>
      <div className="fixed top-0 left-2 z-10">
        <Form method="post" action={path.to.logout}>
          <IconButton
            size="lg"
            type="submit"
            variant="ghost"
            icon={<LuMoveLeft />}
            aria-label={t`Back`}
          />
        </Form>
      </div>
    </>
  );
}
