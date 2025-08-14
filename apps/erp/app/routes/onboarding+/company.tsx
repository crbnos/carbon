import { assertIsPost, getCarbonServiceRole, getUser } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { setCompanyId } from "@carbon/auth/company.server";
import { updateCompanySession } from "@carbon/auth/session.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
import { getSlackClient } from "@carbon/lib/slack.server";
import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { Link, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import { Currency, Hidden, Input, Submit } from "~/components/Form";
import Country from "~/components/Form/Country";
import { useOnboarding } from "~/hooks";
import { insertEmployeeJob } from "~/modules/people";
import { getLocationsList, upsertLocation } from "~/modules/resources";
import {
  getCompanies,
  getCompany,
  insertCompany,
  onboardingCompanyValidator,
  seedCompany,
  updateCompany,
} from "~/modules/settings";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const company = await getCompany(client, companyId ?? 1);

  if (company.error || !company.data) {
    return json({
      company: null,
    });
  }

  return json({ company: company.data });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {});

  // there are no entries in the userToCompany table which
  // dictates RLS for the company table

  const validation = await validator(onboardingCompanyValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const serviceRole = getCarbonServiceRole();
  const slackClient = getSlackClient();

  const { next, ...data } = validation.data;

  let companyId: string | undefined;

  const companies = await getCompanies(client, userId);
  const company = companies?.data?.[0];

  const locations = await getLocationsList(client, company?.id ?? "");
  const location = locations?.data?.[0];

  if (company && location) {
    const [companyUpdate, locationUpdate] = await Promise.all([
      updateCompany(serviceRole, company.id!, {
        ...data,
        updatedBy: userId,
      }),
      upsertLocation(serviceRole, {
        ...location,
        ...data,
        timezone: getLocalTimeZone(),
        updatedBy: userId,
      }),
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
      const [companyInsert] = await Promise.all([
        insertCompany(serviceRole, data, userId),
      ]);
      if (companyInsert.error) {
        console.error(companyInsert.error);
        throw new Error("Fatal: failed to insert company");
      }

      companyId = companyInsert.data?.id;
    }

    if (!companyId) {
      throw new Error("Fatal: failed to get company ID");
    }

    const user = await getUser(serviceRole, userId);

    const [seed] = await Promise.all([
      seedCompany(serviceRole, companyId, userId),
      await slackClient.sendMessage({
        channel: "#leads",
        text: "New lead 🎉",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text:
                `*New Signup* 🥁\n\n` +
                `*Contact Information*\n` +
                `• Name: ${user.data?.firstName} ${user.data?.lastName}\n` +
                `• Email: ${user.data?.email}\n` +
                `• Location: ${data.city}, ${data.stateProvince}\n\n` +
                `• Company: ${data.name}\n\n`,
            },
          },
        ],
      }),
    ]);

    if (seed.error) {
      console.error(seed.error);
      throw new Error("Fatal: failed to seed company");
    }

    const { baseCurrencyCode, ...locationData } = data;

    // TODO: move all of this to transaction
    const [locationInsert] = await Promise.all([
      upsertLocation(serviceRole, {
        ...locationData,
        name: "Headquarters",
        companyId,
        timezone: getLocalTimeZone(),
        createdBy: userId,
      }),
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
      insertEmployeeJob(serviceRole, {
        id: userId,
        companyId,
        locationId,
      }),
    ]);

    if (job.error) {
      console.error(job.error);
      throw new Error("Fatal: failed to insert job");
    }
  }

  const sessionCookie = await updateCompanySession(request, companyId!);
  const companyIdCookie = setCompanyId(companyId!);

  throw redirect(next, {
    headers: [
      ["Set-Cookie", sessionCookie],
      ["Set-Cookie", companyIdCookie],
    ],
  });
}

export default function OnboardingCompany() {
  const { company } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  const initialValues = {
    name: company?.name ?? "",
    addressLine1: company?.addressLine1 ?? "",
    city: company?.city ?? "",
    stateProvince: company?.stateProvince ?? "",
    postalCode: company?.postalCode ?? "",
    countryCode: company?.countryCode ?? "US",
    baseCurrencyCode: company?.baseCurrencyCode ?? "USD",
  };

  return (
    <Card className="max-w-lg">
      <ValidatedForm
        validator={onboardingCompanyValidator}
        defaultValues={initialValues}
        method="post"
      >
        <CardHeader>
          <CardTitle>Now let's set up your company</CardTitle>
        </CardHeader>
        <CardContent>
          <Hidden name="next" value={next} />
          <VStack spacing={4}>
            <Input autoFocus name="name" label="Company Name" />
            <Input name="addressLine1" label="Address" />
            <Input name="city" label="City" />
            <Input name="stateProvince" label="State / Province" />
            <Input name="postalCode" label="Postal Code" />
            <Country name="countryCode" />
            <Currency name="baseCurrencyCode" label="Base Currency" />
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
                Previous
              </Link>
            </Button>
            <Submit>Next</Submit>
          </HStack>
        </CardFooter>
      </ValidatedForm>
    </Card>
  );
}
