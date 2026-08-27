import { CarbonEdition, getUser } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getLogger } from "@carbon/logger";
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
import { LuMoveLeft, LuPhoneCall } from "react-icons/lu";
import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useFetcher, useLoaderData } from "react-router";
import { getCompany, getPlans } from "~/modules/settings";
import { path } from "~/utils/path";

const logger = getLogger("erp", "plan");

// Self-signup is limited to Starter. Higher tiers (Business, GovCloud) are
// sales-assisted only — their cards render, but with a "Talk to Sales" CTA and
// no self-checkout button. Keep this as the single source of truth for both the
// server allow-list and the UI so the two can never disagree.
const SELF_SIGNUP_PLAN_IDS = ["STARTER"];

function usePlans() {
  const { t } = useLingui();
  return {
    STARTER: {
      price: 40,
      userMinimum: 0,
      talkToSales: false,
      description: t`A managed cloud-hosted version of Carbon`,
      features: [
        t`Automatic updates and backups`,
        t`Basic ERP, MES, and QMS functionality`,
        t`Unlimited records`,
        t`Self-onboarding`,
        t`Community support`
      ]
    },
    BUSINESS: {
      price: 100,
      userMinimum: 5,
      talkToSales: true,
      description: t`A managed version with all the advanced features`,
      features: [
        t`Technical support`,
        t`API, webhooks, and integrations`,
        t`Accounting`,
        t`Audit logging`,
        t`All advanced features available`,
        t`5 user minimum`
      ]
    },
    ENTERPRISE: {
      price: null as number | null,
      userMinimum: 0,
      talkToSales: true,
      description: t`A custom solution to meet your needs`,
      features: [
        t`Self-hosted or managed`,
        t`Forward deployed engineer`,
        t`Customizations, training, and integrations`,
        t`CMMC compliant`,
        t`Full setup and migrations`,
        t`SSO/SAML`,
        t`Unlimited functional support`
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

  if (!SELF_SIGNUP_PLAN_IDS.includes(planId)) {
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

  logger.info({ companyId });
  const fetcher = useFetcher<typeof action>();

  // Starter/Business come from the DB (self-checkout via Stripe). Enterprise is
  // a static, sales-assisted tier — no plan row, no self-signup — appended last
  // so all three tiers render on the onboarding step.
  const cards = [
    ...[...plans]
      .sort((a, b) => {
        const priceA = PLANS[a.id as keyof typeof PLANS]?.price ?? 0;
        const priceB = PLANS[b.id as keyof typeof PLANS]?.price ?? 0;
        return priceA - priceB;
      })
      .map((plan) => ({
        id: plan.id,
        name: plan.name,
        stripeTrialPeriodDays: plan.stripeTrialPeriodDays
      })),
    { id: "ENTERPRISE", name: t`Enterprise`, stripeTrialPeriodDays: 0 }
  ];

  return (
    <>
      {/* Not an OnboardingCard — a wide two-column grid rather than a form card —
          but it caps and scrolls for the same reason. Mobile keeps min-h-screen
          and scrolls the page instead. */}
      <div className="flex flex-col max-w-5xl w-full min-h-screen md:min-h-0 md:max-h-full">
        <div className="sticky top-0 z-10 mb-4 rounded-lg">
          <CardHeader>
            <CardTitle>
              <Trans>Select a plan</Trans>
            </CardTitle>
            <CardDescription>
              {t`Select a plan to get started. You won't be charged for the first ${plans[0].stripeTrialPeriodDays} days. Switch or cancel anytime.`}
            </CardDescription>
          </CardHeader>
        </div>

        <div className="flex-1 min-h-0 md:overflow-y-auto">
          <div
            className={cn(
              "grid gap-6",
              cards.length <= 2
                ? "grid-cols-1 md:grid-cols-2"
                : "grid-cols-1 md:grid-cols-3"
            )}
          >
            {cards.map((plan) => {
              const planDetails = PLANS[plan.id as keyof typeof PLANS];
              const price = planDetails?.price;

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
                      {price == null ? (
                        <span className="text-4xl font-bold tracking-tighter">
                          <Trans>Contact us</Trans>
                        </span>
                      ) : (
                        <>
                          <span className="text-5xl font-bold tracking-tighter">
                            {formatter.format(price)}
                          </span>
                          <span className="ml-1 text-sm text-muted-foreground tracking-tighter">
                            <Trans>/month/user</Trans>
                          </span>
                        </>
                      )}
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
                      {SELF_SIGNUP_PLAN_IDS.includes(plan.id) ? (
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
                      ) : null}

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
                      ) : null}
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
