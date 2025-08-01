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
  IconButton,
  VStack,
} from "@carbon/react";
import { getCheckoutUrl } from "@carbon/stripe/stripe.server";
import { Edition } from "@carbon/utils";
import { useLocale } from "@react-aria/i18n";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import { useMemo } from "react";
import { LuGraduationCap, LuMoveLeft, LuPhoneCall } from "react-icons/lu";
import { getCompany, getPlans } from "~/modules/settings";
import { path } from "~/utils/path";

const PLANS = {
  STARTER: {
    price: 30,
    userMinimum: 0,
    talkToSales: false,
    description: "Perfect for tech-forward businesses and small teams",
    features: [
      "ERP, MES, QMS",
      "Cloud-Hosted",
      "Self-Onboarding with Carbon University",
    ],
  },
  BUSINESS: {
    price: 90,
    userMinimum: 5,
    talkToSales: true,
    description: "For growing businesses that need support",
    features: [
      "5 User Minimum",
      "Everything from Starter",
      "API and Webhooks",
      "Implementation Support",
      "Unlimited Functional Support",
      // <div key="ai-agents" className="flex items-center gap-2">
      //   <span>AI Agents</span>
      //   <Badge variant="outline">Beta</Badge>
      // </div>,
    ],
  },
} as const;

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

  return json({ plans: plans.data?.filter((p) => p.public) });
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const formData = await request.formData();
  const planId = String(formData.get("planId"));

  if (!planId) {
    throw new Error("Plan ID is required");
  }

  if (!(planId in PLANS) || planId.startsWith("PARTNER")) {
    throw new Error("Invalid plan ID");
  }

  const [user, company] = await Promise.all([
    getUser(client, userId),
    getCompany(client, companyId),
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
    email: user.data?.email,
  });

  throw redirect(url);
}

export default function OnboardingPlan() {
  const { plans } = useLoaderData<typeof loader>();
  const { locale } = useLocale();
  const formatter = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    [locale]
  );

  const fetcher = useFetcher<typeof action>();

  return (
    <>
      <div className="flex flex-col max-w-2xl w-full min-h-screen md:min-h-0">
        <div className="sticky top-0 bg-background z-10 pb-4">
          <CardHeader>
            <CardTitle>Select a plan</CardTitle>
            <CardDescription>
              Select a plan to get started. You won't be charged for the first{" "}
              {plans[0].stripeTrialPeriodDays} days. Switch or cancel anytime.
            </CardDescription>
          </CardHeader>
        </div>

        <CardContent className="flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                          /month/user
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
                            Start {plan.stripeTrialPeriodDays} Day Free Trial
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
                              Talk to Sales
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
                              Start Learning
                            </a>
                          </Button>
                        )}
                      </VStack>
                    </CardFooter>
                  </Card>
                );
              })}
          </div>
        </CardContent>
      </div>
      <div className="fixed top-0 left-2 z-10">
        <Form method="post" action={path.to.logout}>
          <IconButton
            size="lg"
            type="submit"
            variant="ghost"
            icon={<LuMoveLeft />}
            aria-label="Back"
          />
        </Form>
      </div>
    </>
  );
}
