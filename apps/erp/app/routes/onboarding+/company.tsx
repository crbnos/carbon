import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { ValidatedForm, validationError, validator } from "@carbon/form";
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
import {
  type ActionFunctionArgs,
  Link,
  redirect,
  useLoaderData
} from "react-router";
import {
  AddressAutocomplete,
  Currency,
  Hidden,
  Input,
  Submit
} from "~/components/Form";
import { useOnboarding } from "~/hooks";
import { addressValidator, getCompany } from "~/modules/settings";
import {
  getOnboardingDraft,
  setOnboardingDraft
} from "~/services/onboarding-draft.server";

export async function loader({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const company = await getCompany(client, companyId ?? 1);
  const draft = await getOnboardingDraft(request);

  if (company.error || !company.data) {
    return {
      company: null,
      draft
    };
  }

  return { company: company.data, draft };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {});

  const formData = await request.formData();

  const validation = await validator(addressValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { next, ...companyData } = validation.data;

  // Store company data in session draft for the next step (industry)
  const draftCookie = await setOnboardingDraft(request, {
    company: companyData
  });

  throw redirect(next, {
    headers: [["Set-Cookie", draftCookie]]
  });
}

export default function OnboardingCompany() {
  const { company, draft } = useLoaderData<typeof loader>();
  const { next, previous } = useOnboarding();

  const initialValues = {
    name: company?.name ?? draft?.company?.name ?? "",
    addressLine1: company?.addressLine1 ?? draft?.company?.addressLine1 ?? "",
    addressLine2: company?.addressLine2 ?? draft?.company?.addressLine2 ?? "",
    city: company?.city ?? draft?.company?.city ?? "",
    stateProvince:
      company?.stateProvince ?? draft?.company?.stateProvince ?? "",
    postalCode: company?.postalCode ?? draft?.company?.postalCode ?? "",
    countryCode: company?.countryCode ?? draft?.company?.countryCode ?? "US",
    baseCurrencyCode:
      company?.baseCurrencyCode ?? draft?.company?.baseCurrencyCode ?? "USD",
    website: company?.website ?? draft?.company?.website ?? ""
  };

  return (
    <Card className="max-w-lg">
      <ValidatedForm
        validator={addressValidator}
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
            <AddressAutocomplete />
            <Input name="website" label="Website" />
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
