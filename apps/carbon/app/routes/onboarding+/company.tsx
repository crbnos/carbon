import { ValidatedForm, validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  VStack,
} from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import { Link, useLoaderData } from "@remix-run/react";
import { json, redirect, type ActionFunctionArgs } from "@vercel/remix";
import { Hidden, Input, Submit } from "~/components/Form";
import { useOnboarding } from "~/hooks";
import logger from "~/lib/logger";
import { getSupabaseServiceRole } from "~/lib/supabase";
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
import { requirePermissions } from "~/services/auth/auth.server";
import { updateCompanySession } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";

export async function loader({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "settings",
  });

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
  const { client, userId } = await requirePermissions(request, {
    update: "settings",
  });

  // there are no entries in the userToCompany table which
  // dictates RLS for the company table

  const validation = await validator(onboardingCompanyValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const supabaseClient = getSupabaseServiceRole();
  const { next, ...data } = validation.data;

  let companyId: string | undefined;

  const companies = await getCompanies(client, userId);
  const company = companies?.data?.[0];

  const locations = await getLocationsList(client, company?.id ?? "");
  const location = locations?.data?.[0];

  if (company && location) {
    const [companyUpdate, locationUpdate] = await Promise.all([
      updateCompany(supabaseClient, company.id!, {
        ...data,
        updatedBy: userId,
      }),
      upsertLocation(supabaseClient, {
        ...location,
        ...data,
        timezone: getLocalTimeZone(),
        updatedBy: userId,
      }),
    ]);
    if (companyUpdate.error) {
      logger.error(companyUpdate.error);
      throw new Error("Fatal: failed to update company");
    }
    if (locationUpdate.error) {
      logger.error(locationUpdate.error);
      throw new Error("Fatal: failed to update location");
    }
  } else {
    const companyInsert = await insertCompany(supabaseClient, data);
    if (companyInsert.error) {
      logger.error(companyInsert.error);
      throw new Error("Fatal: failed to insert company");
    }

    companyId = companyInsert.data?.id;
    if (!companyId) {
      throw new Error("Fatal: failed to get company ID");
    }

    const seed = await seedCompany(supabaseClient, companyId, userId);
    if (seed.error) {
      logger.error(seed.error);
      throw new Error("Fatal: failed to seed company");
    }

    // TODO: move all of this to transaction
    const [locationInsert] = await Promise.all([
      upsertLocation(supabaseClient, {
        ...data,
        name: "Headquarters",
        companyId,
        timezone: getLocalTimeZone(),
        createdBy: userId,
      }),
    ]);

    if (locationInsert.error) {
      logger.error(locationInsert.error);
      throw new Error("Fatal: failed to insert location");
    }

    const locationId = locationInsert.data?.id;
    if (!locationId) {
      throw new Error("Fatal: failed to get location ID");
    }

    const [job] = await Promise.all([
      insertEmployeeJob(supabaseClient, {
        id: userId,
        companyId,
        locationId,
      }),
    ]);

    if (job.error) {
      logger.error(job.error);
      throw new Error("Fatal: failed to insert job");
    }
  }

  throw redirect(next, {
    headers: {
      "Set-Cookie": await updateCompanySession(request, companyId!),
    },
  });
}

export default function OnboardingCompany() {
  const { company } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  const initialValues = {
    name: company?.name ?? "",
    addressLine1: company?.addressLine1 ?? "",
    city: company?.city ?? "",
    state: company?.state ?? "",
    postalCode: company?.postalCode ?? "",
  };

  return (
    <Card className="max-w-lg">
      <ValidatedForm
        validator={onboardingCompanyValidator}
        defaultValues={initialValues}
        method="post"
      >
        <CardHeader>
          <CardTitle>Now let's setup your company</CardTitle>
          <CardDescription>You can always change this later</CardDescription>
        </CardHeader>
        <CardContent>
          <Hidden name="next" value={next} />
          <VStack spacing={4}>
            <Input autoFocus name="name" label="Company Name" />
            <Input name="addressLine1" label="Address" />
            <Input name="city" label="City" />
            <Input name="state" label="State" />
            <Input name="postalCode" label="Zip Code" />
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
