import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ChoiceCardGroup,
  type ChoiceCardOption,
  cn,
  HStack
} from "@carbon/react";
import { isInternalEmail } from "@carbon/utils";
import { type ReactNode, useState } from "react";
import {
  LuBot,
  LuCog,
  LuDatabase,
  LuFactory,
  LuFileX,
  LuUpload,
  LuWrench
} from "react-icons/lu";
import {
  type ActionFunctionArgs,
  Form,
  Link,
  redirect,
  useLoaderData,
  useNavigation
} from "react-router";
import { z } from "zod";
import { Hidden, Submit } from "~/components/Form";
import { useOnboarding } from "~/hooks";
import {
  getCompany,
  getIndustries,
  onboardingCompanyValidator
} from "~/modules/settings";
import { provisionOnboardingCompany } from "~/services/onboarding.server";
import {
  clearOnboardingDraft,
  getOnboardingDraft,
  type OnboardingDraft
} from "~/services/onboarding-draft.server";
import { path } from "~/utils/path";

type DataChoice = "template" | "import" | "none";

const onboardingIndustryValidator = z
  .object({
    industryId: z.string().optional(),
    customIndustryDescription: z.string().optional(),
    dataChoice: z.enum(["template", "import", "none"]).default("none"),
    next: z.string()
  })
  .refine((data) => !(data.dataChoice === "template" && !data.industryId), {
    message: "Please select an industry for the demo template",
    path: ["industryId"]
  });

/** Industry icons live in code (JSX can't be stored in the DB); the `industry`
 *  table carries an `iconName` that maps here. */
const INDUSTRY_ICONS: Record<string, ReactNode> = {
  bot: <LuBot className="h-5 w-5" />,
  cog: <LuCog className="h-5 w-5" />,
  wrench: <LuWrench className="h-5 w-5" />
};

/** Append the company data captured in the previous onboarding step. */
function appendDraftCompany(
  fd: FormData,
  company: NonNullable<OnboardingDraft["company"]>
) {
  for (const [key, value] of Object.entries(company)) {
    if (value) fd.append(key, value);
  }
}

export async function loader({ request }: ActionFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {});

  // The data-choice step is internal-only; public signups create their company
  // in the company step. Guard direct navigation to this route.
  if (!isInternalEmail(email)) {
    throw redirect(path.to.onboarding.company);
  }

  const company = await getCompany(client, companyId);
  const draft = await getOnboardingDraft(request);
  const industries = (await getIndustries(client)).data ?? [];

  if (company.error || !company.data) {
    return { company: null, draft, industries };
  }

  return { company: company.data, draft, industries };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, email } = await requirePermissions(request, {});

  // Internal-only step — reject direct POSTs from public signups.
  if (!isInternalEmail(email)) {
    throw redirect(path.to.onboarding.company);
  }

  // Get draft data from previous step (company)
  const draft = await getOnboardingDraft(request);

  const formData = await request.formData();

  // Validate industry fields
  const industryValidation = await validator(
    onboardingIndustryValidator
  ).validate(formData);

  if (industryValidation.error) {
    return validationError(industryValidation.error);
  }

  const { dataChoice } = industryValidation.data;

  // Carry forward the company data captured in the previous (company) step.
  if (draft?.company) appendDraftCompany(formData, draft.company);

  const validation = await validator(onboardingCompanyValidator).validate(
    formData
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = getCarbonServiceRole();
  const { next, ...d } = validation.data;
  const companyData = {
    ...d,
    industryId: d.industryId || null
  };

  // "Restore from a backup" → the user's uploaded `.carbon.tar.gz`; every other
  // choice → a clean seed (no backup).
  const backupFile = formData.get("backup");
  const backup: Blob | null =
    dataChoice === "import" && backupFile instanceof File && backupFile.size > 0
      ? backupFile
      : null;

  const companyId = await provisionOnboardingCompany(serviceRole, client, {
    userId,
    companyData,
    backup
  });

  const companyRecord = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId)
    .single();
  const sessionCookie = await updateCompanySession(
    request,
    companyId,
    companyRecord.data?.companyGroupId ?? ""
  );
  const companyIdCookie = setCompanyId(companyId);
  const clearDraftCookie = await clearOnboardingDraft(request);

  throw redirect(next, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie],
      ["Set-Cookie", clearDraftCookie]
    ]
  });
}

type Step = "data-question" | "industry-selection" | "import-upload";

export default function OnboardingIndustry() {
  const { company, industries } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  // Determine initial step based on existing company data
  const getInitialStep = (): Step => {
    if (company?.industryId) {
      return "industry-selection";
    }
    return "data-question";
  };

  const [step, setStep] = useState<Step>(getInitialStep);
  const [dataChoice, setDataChoice] = useState<DataChoice>("template");
  const [importFile, setImportFile] = useState<File | null>(null);
  const navigation = useNavigation();
  // Provisioning (unpack + seed + enqueue import) runs in the action and can take
  // a while for a real backup — keep the button busy so the user doesn't re-submit.
  const isSubmitting = navigation.state !== "idle";
  const [selectedIndustryId, setSelectedIndustryId] = useState<string>(
    company?.industryId ?? ""
  );

  const initialValues = {
    industryId: industries.some((i) => i.id === company?.industryId)
      ? (company?.industryId ?? undefined)
      : undefined,
    customIndustryDescription: company?.customIndustryDescription ?? ""
  };

  const industryOptions: ChoiceCardOption[] = industries.map((i) => ({
    value: i.id,
    title: i.name,
    description: i.description ?? "",
    icon: INDUSTRY_ICONS[i.iconName ?? ""] ?? <LuFactory className="h-5 w-5" />
  }));

  const handleNext = () => {
    if (dataChoice === "template") setStep("industry-selection");
    else if (dataChoice === "import") setStep("import-upload");
    // "none" submits the form directly via the Submit button
  };

  const dataChoiceOptions: ChoiceCardOption<DataChoice>[] = [
    {
      value: "template",
      title: "Use a demo template",
      description:
        "We'll add sample customers, suppliers, parts and quotes to explore Carbon",
      icon: <LuDatabase className="h-5 w-5" />
    },
    {
      value: "import" as const,
      title: "Restore from a backup",
      description: "Set up from a Carbon backup of another company",
      icon: <LuUpload className="h-5 w-5" />
    },
    {
      value: "none",
      title: "I don't need data",
      description: "Start with a clean, empty environment",
      icon: <LuFileX className="h-5 w-5" />
    }
  ];

  if (step === "import-upload") {
    return (
      <Card className="max-w-lg">
        <Form method="post" encType="multipart/form-data">
          <CardHeader>
            <CardTitle>Restore from a backup</CardTitle>
            <CardDescription>
              Upload a Carbon backup and we'll set up your new company from it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="dataChoice" value="import" />
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
                "border-border hover:border-primary/50 hover:bg-accent/50"
              )}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <LuUpload className="h-5 w-5" />
              </div>
              {importFile ? (
                <span className="text-sm font-medium text-foreground">
                  {importFile.name}
                </span>
              ) : (
                <>
                  <span className="text-sm font-medium text-foreground">
                    Choose your backup file
                  </span>
                  <span className="text-xs text-muted-foreground">
                    A Carbon backup (.carbon.tar.gz)
                  </span>
                </>
              )}
              <input
                type="file"
                name="backup"
                accept=".tar.gz,.tgz,application/gzip"
                className="sr-only"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </CardContent>
          <CardFooter>
            <HStack>
              <Button
                variant="solid"
                size="md"
                type="button"
                isDisabled={isSubmitting}
                onClick={() => setStep("data-question")}
              >
                Previous
              </Button>
              <Button
                variant="primary"
                size="md"
                type="submit"
                isLoading={isSubmitting}
                isDisabled={!importFile || isSubmitting}
              >
                {isSubmitting ? "Setting up…" : "Create company"}
              </Button>
            </HStack>
          </CardFooter>
        </Form>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg">
      <ValidatedForm
        validator={onboardingIndustryValidator}
        defaultValues={initialValues}
        method="post"
      >
        {step === "data-question" ? (
          <>
            <CardHeader>
              <CardTitle>How would you like to start?</CardTitle>
              <CardDescription>
                Choose how to set up your new company.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="next" value={next} />
              <Hidden name="dataChoice" value={dataChoice} />
              <ChoiceCardGroup
                className="max-w-md"
                value={dataChoice}
                onChange={setDataChoice}
                options={dataChoiceOptions}
              />
            </CardContent>

            <CardFooter>
              <HStack>
                <Button
                  variant="solid"
                  isDisabled={!previous}
                  size="md"
                  asChild
                  tabIndex={-1}
                >
                  <Link to={previous} prefetch="intent">
                    Previous
                  </Link>
                </Button>
                {dataChoice === "none" ? (
                  <Submit>Next</Submit>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    type="button"
                    onClick={handleNext}
                  >
                    Next
                  </Button>
                )}
              </HStack>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Which best describes your company?</CardTitle>
              <CardDescription>
                We'll set up demo data to match your industry
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Hidden name="next" value={next} />
              <Hidden name="dataChoice" value="template" />
              <Hidden name="industryId" value={selectedIndustryId} />
              <ChoiceCardGroup
                value={selectedIndustryId}
                onChange={setSelectedIndustryId}
                options={industryOptions}
              />
            </CardContent>

            <CardFooter>
              <HStack>
                <Button
                  variant="solid"
                  size="md"
                  type="button"
                  onClick={() => setStep("data-question")}
                >
                  Previous
                </Button>
                <Submit isDisabled={!selectedIndustryId}>Next</Submit>
              </HStack>
            </CardFooter>
          </>
        )}
      </ValidatedForm>
    </Card>
  );
}
