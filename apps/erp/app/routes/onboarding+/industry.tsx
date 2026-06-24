import { assertIsPost, CarbonEdition } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
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
import { Edition } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
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
  useLoaderData
} from "react-router";
import { z } from "zod";
import { Hidden, Submit } from "~/components/Form";
import { useOnboarding } from "~/hooks";
import { insertEmployeeJob } from "~/modules/people";
import { getLocationsList, upsertLocation } from "~/modules/resources";
import {
  getCompanies,
  getCompany,
  getIndustries,
  insertCompany,
  onboardingCompanyValidator,
  updateCompany
} from "~/modules/settings";
import {
  fetchTemplateBackup,
  provisionCompanyData
} from "~/services/onboarding.server";
import {
  clearOnboardingDraft,
  getOnboardingDraft,
  type OnboardingDraft
} from "~/services/onboarding-draft.server";

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
  const { client, companyId } = await requirePermissions(request, {});

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
  const { client, userId } = await requirePermissions(request, {});

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

  const { industryId, dataChoice } = industryValidation.data;
  const finalIndustryId = industryId || null;

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

  let companyId: string | undefined;

  const companies = await getCompanies(client, userId);
  const company = companies?.data?.[0];

  const locations = await getLocationsList(client, company?.id ?? "");
  const location = locations?.data?.[0];

  // Extract address data for location
  const addressData = {
    addressLine1: d.addressLine1,
    addressLine2: d.addressLine2,
    city: d.city,
    stateProvince: d.stateProvince,
    postalCode: d.postalCode,
    countryCode: d.countryCode
  };

  if (company && location) {
    // Update existing company and location
    const [companyUpdate, locationUpdate] = await Promise.all([
      updateCompany(serviceRole, company.id!, {
        ...companyData,
        updatedBy: userId
      }),
      upsertLocation(serviceRole, {
        ...location,
        ...addressData,
        timezone: getLocalTimeZone(),
        updatedBy: userId
      })
    ]);
    if (companyUpdate.error) {
      console.error(companyUpdate.error);
      throw new Error("Fatal: failed to update company");
    }
    if (locationUpdate.error) {
      console.error(locationUpdate.error);
      throw new Error("Fatal: failed to update location");
    }

    companyId = company.id!;
  } else {
    // Create new company.
    const companyInsert = await insertCompany(serviceRole, companyData);
    if (companyInsert.error) {
      console.error(companyInsert.error);
      throw new Error("Fatal: failed to insert company");
    }
    companyId = companyInsert.data?.id;
    if (!companyId) {
      throw new Error("Fatal: failed to get company ID");
    }

    // A demo template and "restore from a backup" both resolve to a backup
    // file; "none" → a clean seed. provisionCompanyData imports it or seeds.
    const backupFile = formData.get("backup");
    const backup: Blob | null =
      dataChoice === "import" &&
      backupFile instanceof File &&
      backupFile.size > 0
        ? backupFile
        : dataChoice === "template"
          ? await fetchTemplateBackup(serviceRole, finalIndustryId)
          : null;

    await provisionCompanyData(serviceRole, {
      companyId,
      userId,
      backup,
      // Only a demo template references shared assets; a user's own uploaded
      // backup ("import") stays self-contained and is copied per company.
      templateIndustryId: dataChoice === "template" ? finalIndustryId : null
    });

    if (CarbonEdition === Edition.Cloud) {
      trigger("onboard", {
        type: "lead",
        companyId,
        userId
      });
    }

    // Create location
    const [locationInsert] = await Promise.all([
      upsertLocation(serviceRole, {
        ...addressData,
        name: "Headquarters",
        companyId,
        timezone: getLocalTimeZone(),
        createdBy: userId
      })
    ]);

    if (locationInsert.error) {
      console.error(locationInsert.error);
      throw new Error("Fatal: failed to insert location");
    }

    const locationId = locationInsert.data?.id;
    if (!locationId) {
      throw new Error("Fatal: failed to get location ID");
    }

    // Create employee job
    const [job] = await Promise.all([
      insertEmployeeJob(serviceRole, {
        id: userId,
        companyId,
        locationId
      })
    ]);

    if (job.error) {
      console.error(job.error);
      throw new Error("Fatal: failed to insert job");
    }
  }

  const companyRecord = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId!)
    .single();
  const sessionCookie = await updateCompanySession(
    request,
    companyId!,
    companyRecord.data?.companyGroupId ?? ""
  );
  const companyIdCookie = setCompanyId(companyId!);
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
                    A Carbon backup (.carbon.json.gz)
                  </span>
                </>
              )}
              <input
                type="file"
                name="backup"
                accept=".gz,application/gzip"
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
                onClick={() => setStep("data-question")}
              >
                Previous
              </Button>
              <Button
                variant="primary"
                size="md"
                type="submit"
                isDisabled={!importFile}
              >
                Create company
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
