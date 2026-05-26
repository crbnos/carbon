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
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  VStack
} from "@carbon/react";
import { Edition } from "@carbon/utils";
import { getLocalTimeZone } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData } from "react-router";
import {
  AddressAutocomplete,
  Currency,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { useOnboarding } from "~/hooks";
import { insertEmployeeJob } from "~/modules/people/people.service.server";
import {
  getLocationsList,
  upsertLocation
} from "~/modules/resources/resources.service.server";
import { onboardingCompanyValidator } from "~/modules/settings";
import {
  getCompanies,
  getCompany,
  insertCompany,
  seedCompany,
  updateCompany
} from "~/modules/settings/settings.service.server";
import { AuthClientScope } from "~/services/mcp/index.server";

export async function loader({ request }: ActionFunctionArgs) {
  await requirePermissions(request, {});

  // During onboarding there are no userToCompany rows yet, so RLS would
  // return nothing for the company table. getCompany is clientless and
  // resolves its client from AuthClientScope; pin it to serviceRole to
  // keep the RLS-bypass behavior this flow relied on before the refactor.
  const serviceRole = getCarbonServiceRole();
  AuthClientScope.setFactory(() => serviceRole);

  const company = await getCompany();

  if (company.error || !company.data) {
    return {
      company: null
    };
  }

  return { company: company.data };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {});

  // there are no entries in the userToCompany table which
  // dictates RLS for the company table

  const validation = await validator(onboardingCompanyValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = getCarbonServiceRole();
  // The clientless onboarding helpers (getCompanies, seedCompany,
  // updateCompany, upsertLocation, insertCompany, insertEmployeeJob) resolve
  // their client from AuthClientScope. Per the note above there are no
  // userToCompany RLS rows yet, so pin the scope to serviceRole to keep the
  // RLS-bypass behavior this flow relied on before the refactor.
  AuthClientScope.setFactory(() => serviceRole);

  const { next, ...d } = validation.data;

  let companyId: string | undefined;

  const companies = await getCompanies();
  const company = companies?.data?.[0];

  const locations = await getLocationsList();
  const location = locations?.data?.[0];

  if (company && location) {
    const [companyUpdate, locationUpdate] = await Promise.all([
      updateCompany({
        ...d,
        updatedBy: userId
      }),
      upsertLocation({
        ...location,
        ...d,
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
  } else {
    if (!companyId) {
      const [companyInsert] = await Promise.all([insertCompany(d)]);
      if (companyInsert.error) {
        console.error(companyInsert.error);
        throw new Error("Fatal: failed to insert company");
      }

      companyId = companyInsert.data?.id;
    }

    if (!companyId) {
      throw new Error("Fatal: failed to get company ID");
    }

    const seed = await seedCompany(undefined, { companyId, userId });
    if (seed.error) {
      console.error(seed.error);
      throw new Error("Fatal: failed to seed company");
    }

    if (CarbonEdition === Edition.Cloud) {
      trigger("onboard", {
        type: "lead",
        companyId,
        userId
      });
    }

    // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
    const { baseCurrencyCode, website, ...locationData } = d;

    // TODO: move all of this to transaction
    const [locationInsert] = await Promise.all([
      upsertLocation({
        ...locationData,
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

    const [job] = await Promise.all([
      insertEmployeeJob({
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

  const { data: companyRecord } = await serviceRole
    .from("company")
    .select("companyGroupId")
    .eq("id", companyId!)
    .single();

  const sessionCookie = await updateCompanySession(
    request,
    companyId!,
    companyRecord?.companyGroupId ?? ""
  );
  const companyIdCookie = setCompanyId(companyId!);

  throw redirect(next, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie]
    ]
  });
}

export default function OnboardingCompany() {
  const { t } = useLingui();
  const { company } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  const initialValues = {
    name: company?.name ?? "",
    addressLine1: company?.addressLine1 ?? "",
    city: company?.city ?? "",
    stateProvince: company?.stateProvince ?? "",
    postalCode: company?.postalCode ?? "",
    countryCode: company?.countryCode ?? "US",
    baseCurrencyCode: company?.baseCurrencyCode ?? "USD"
  };

  return (
    <Card className="max-w-lg">
      <ValidatedForm
        validator={onboardingCompanyValidator}
        defaultValues={initialValues}
        method="post"
      >
        <CardHeader>
          <CardTitle>
            <Trans>Now let's set up your company</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="next" value={next} />
          <VStack spacing={4}>
            <Input autoFocus name="name" label={t`Company Name`} />
            <AddressAutocomplete />
            <Input name="website" label={t`Website`} />
            <Currency name="baseCurrencyCode" label={t`Base Currency`} />
          </VStack>
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
                <Trans>Previous</Trans>
              </Link>
            </Button>
            <Submit>
              <Trans>Next</Trans>
            </Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
