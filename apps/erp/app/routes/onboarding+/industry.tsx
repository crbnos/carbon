// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { datasetForIndustry } from "@carbon/database/datasets";
import { TEMP_STAGING_BUCKET } from "@carbon/files";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Button,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ChoiceCardGroup,
  type ChoiceCardOption,
  cn,
  HStack,
  PrefetchLink
} from "@carbon/react";
import { isInternalEmail, redirect } from "@carbon/utils";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  LuBot,
  LuCog,
  LuDatabase,
  LuFactory,
  LuFileX,
  LuSatellite,
  LuShield,
  LuUpload,
  LuWrench
} from "react-icons/lu";
import {
  type ActionFunctionArgs,
  Form,
  useLoaderData,
  useNavigation,
  useSubmit
} from "react-router";
import { z } from "zod";
import {
  OnboardingCard,
  OnboardingCardContent,
  onboardingFormClassName
} from "~/components";
import { Hidden, Submit } from "~/components/Form";
import { UploadProgress } from "~/components/UploadProgress";
import { useOnboarding } from "~/hooks";
import { onboardingCompanyValidator } from "~/modules/settings/settings.models";
import {
  getCompany,
  getIndustries,
  isStagedBackupPath
} from "~/modules/settings/settings.service";
import {
  clearOnboardingDraft,
  getOnboardingDraft,
  type OnboardingDraft
} from "~/modules/shared/shared.service";
import {
  onboardingBackupPrefix,
  provisionOnboardingCompany
} from "~/services/onboarding.server";
import { ONBOARDING_SHORTCUTS } from "~/shortcuts";
import { path } from "~/utils/path";
import { uploadToSignedUrlWithProgress } from "~/utils/signed-upload";

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
  satellite: <LuSatellite className="h-5 w-5" />,
  shield: <LuShield className="h-5 w-5" />,
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
  const { client, companyId, email } = await requirePermissions(request, {
    // Onboarding acts on the user's own account: a portal-only user may still
    // create a company of their own.
    allowPortalAccounts: true
  });

  // Restoring from a backup stays internal-only; the demo template and a clean
  // start are open to every signup.
  const canRestoreBackup = isInternalEmail(email);

  const company = await getCompany(client, companyId);
  const draft = await getOnboardingDraft(request);
  const allIndustries = (await getIndustries(client)).data ?? [];

  // Only industries with a registered dataset can be offered under "Use a demo
  // template" — the others would create a clean company while the card promises
  // sample data, with nothing to tell the user which happened.
  const industries = allIndustries.filter((i) => datasetForIndustry(i.id));

  if (company.error || !company.data) {
    return { company: null, draft, industries, canRestoreBackup };
  }

  return { company: company.data, draft, industries, canRestoreBackup };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, email } = await requirePermissions(request, {
    // Onboarding acts on the user's own account: a portal-only user may still
    // create a company of their own.
    allowPortalAccounts: true
  });

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

  // Backup restore is internal-only — reject direct POSTs from public signups.
  if (dataChoice === "import" && !isInternalEmail(email)) {
    throw redirect(path.to.onboarding.industry);
  }

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

  // "Restore from a backup" → the archive the browser staged for this user;
  // every other choice → a clean seed (no backup).
  const staged = formData.get("backupPath");
  const backupPath =
    dataChoice === "import" &&
    isStagedBackupPath(staged, onboardingBackupPrefix(userId))
      ? staged
      : null;
  if (dataChoice === "import" && !backupPath) {
    return validationError({
      fieldErrors: { backupPath: "Upload a Carbon backup" }
    });
  }

  // "Use a demo template" → the dataset registered for the chosen industry.
  // The loader only offers industries that have one; refuse rather than fall
  // through to a clean seed, which would look identical to a crashed job.
  let template: string | null = null;
  if (dataChoice === "template") {
    const dataset = datasetForIndustry(companyData.industryId);
    if (!dataset) {
      return validationError({
        fieldErrors: {
          industryId: "No demo data is available for that industry yet"
        }
      });
    }
    template = dataset.key;
  }

  const companyId = await provisionOnboardingCompany(serviceRole, client, {
    userId,
    companyData,
    backupPath,
    template
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

  throw redirect(next || path.to.onboarding.root, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie],
      ["Set-Cookie", clearDraftCookie]
    ]
  });
}

type Step = "data-question" | "industry-selection" | "import-upload";

export default function OnboardingIndustry() {
  const { company, industries, canRestoreBackup } =
    useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  // Determine initial step based on existing company data
  const getInitialStep = (): Step => {
    if (company?.industryId) {
      return "industry-selection";
    }
    return "data-question";
  };

  // The loader already dropped industries with no dataset; if that leaves none,
  // there is no demo template to offer at all.
  const canUseTemplate = industries.length > 0;

  const [step, setStep] = useState<Step>(getInitialStep);
  const [dataChoice, setDataChoice] = useState<DataChoice>(
    canUseTemplate ? "template" : "none"
  );
  const [importFile, setImportFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const navigation = useNavigation();
  const submit = useSubmit();
  // Provisioning (unpack + seed + enqueue import) runs in the action and can take
  // a while for a real backup — keep the button busy so the user doesn't re-submit.
  const isSubmitting = navigation.state !== "idle" || uploaded !== null;

  // The archive goes straight to storage with a signed token (a serverless
  // request body is capped well below a real backup); the form posts its path.
  const onImport = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!importFile) return;
    setUploadError(null);
    setUploaded(0);
    try {
      const res = await fetch(path.to.api.onboardingBackupUpload, {
        method: "POST"
      });
      if (!res.ok) throw new Error(await res.text());
      const slot = (await res.json()) as { path: string; token: string };
      await uploadToSignedUrlWithProgress({
        bucket: TEMP_STAGING_BUCKET,
        path: slot.path,
        token: slot.token,
        file: importFile,
        onProgress: (done) => setUploaded(done)
      });
      submit(
        { next, dataChoice: "import", backupPath: slot.path },
        { method: "post" }
      );
    } catch (err) {
      setUploadError((err as Error).message || "Upload failed");
    } finally {
      setUploaded(null);
    }
  };
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
    ...(canUseTemplate
      ? [
          {
            value: "template" as const,
            title: "Use a demo template",
            description:
              "We'll set up sample customers, suppliers, parts and orders — they appear shortly after you finish",
            icon: <LuDatabase className="h-5 w-5" />
          }
        ]
      : []),
    ...(canRestoreBackup
      ? [
          {
            value: "import" as const,
            title: "Restore from a backup",
            description:
              "Set up from a backup of another Carbon company environment",
            icon: <LuUpload className="h-5 w-5" />
          }
        ]
      : []),
    {
      value: "none",
      title: "I don't need data",
      description: "Start with a clean, empty environment",
      icon: <LuFileX className="h-5 w-5" />
    }
  ];

  if (step === "import-upload") {
    return (
      <OnboardingCard>
        <Form
          method="post"
          onSubmit={onImport}
          className={onboardingFormClassName}
        >
          <CardHeader>
            <CardTitle>Restore from a backup</CardTitle>
            <CardDescription>
              Upload a Carbon backup and we'll set up your new company from it.
            </CardDescription>
          </CardHeader>
          <OnboardingCardContent>
            <input type="hidden" name="next" value={next} />
            <input type="hidden" name="dataChoice" value="import" />
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
                "border-border hover:border-primary/50 hover:bg-accent/50",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
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
                accept=".tar.gz,.tgz,application/gzip"
                className="sr-only"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {uploaded !== null && importFile && (
              <UploadProgress
                percent={
                  importFile.size ? (uploaded / importFile.size) * 100 : 0
                }
                uploaded={uploaded}
                total={importFile.size}
                label="Uploading backup"
                description="Uploading the backup file"
              />
            )}
            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}
          </OnboardingCardContent>
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
                shortcut={ONBOARDING_SHORTCUTS.continue}
                isLoading={isSubmitting}
                isDisabled={!importFile || isSubmitting}
              >
                {isSubmitting ? "Setting up…" : "Create company"}
              </Button>
            </HStack>
          </CardFooter>
        </Form>
      </OnboardingCard>
    );
  }

  return (
    <OnboardingCard>
      <ValidatedForm
        validator={onboardingIndustryValidator}
        defaultValues={initialValues}
        method="post"
        className={onboardingFormClassName}
      >
        {step === "data-question" ? (
          <>
            <CardHeader>
              <CardTitle>How would you like to start?</CardTitle>
              <CardDescription>
                Choose how to set up your new company.
              </CardDescription>
            </CardHeader>
            <OnboardingCardContent>
              <Hidden name="next" value={next} />
              <Hidden name="dataChoice" value={dataChoice} />
              <ChoiceCardGroup
                className="max-w-md"
                value={dataChoice}
                onChange={setDataChoice}
                options={dataChoiceOptions}
                autoFocus
              />
            </OnboardingCardContent>

            <CardFooter>
              <HStack>
                <Button
                  variant="solid"
                  isDisabled={!previous}
                  size="md"
                  asChild
                  tabIndex={-1}
                >
                  <PrefetchLink to={previous}>Previous</PrefetchLink>
                </Button>
                {dataChoice === "none" ? (
                  <Submit shortcut={ONBOARDING_SHORTCUTS.continue}>Next</Submit>
                ) : (
                  <Button
                    variant="primary"
                    size="md"
                    type="button"
                    shortcut={ONBOARDING_SHORTCUTS.continue}
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
            <OnboardingCardContent>
              <Hidden name="next" value={next} />
              <Hidden name="dataChoice" value="template" />
              <Hidden name="industryId" value={selectedIndustryId} />
              <ChoiceCardGroup
                value={selectedIndustryId}
                onChange={setSelectedIndustryId}
                options={industryOptions}
                autoFocus
              />
            </OnboardingCardContent>

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
                <Submit
                  isDisabled={!selectedIndustryId}
                  shortcut={ONBOARDING_SHORTCUTS.continue}
                >
                  Next
                </Submit>
              </HStack>
            </CardFooter>
          </>
        )}
      </ValidatedForm>
    </OnboardingCard>
  );
}
