import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTitle
} from "@carbon/react";
import { getLocalTimeZone } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { useUser } from "~/hooks";
import { insertEmployeeJob } from "~/modules/people";
import { upsertLocation } from "~/modules/resources";
import {
  insertCompany,
  SubsidiaryCompanyForm,
  seedCompany,
  subsidiaryValidator
} from "~/modules/settings";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    create: "settings"
  });

  const formData = await request.formData();
  const validation = await validator(subsidiaryValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    id: _,
    parentCompanyId,
    baseCurrencyCode,
    ...locationData
  } = validation.data;

  const client = getCarbonServiceRole();

  const companyInsert = await insertCompany(client, {
    ...locationData,
    baseCurrencyCode
  });
  if (companyInsert.error) {
    throw redirect(
      path.to.companies,
      await flash(
        request,
        error(companyInsert.error, "Failed to create company")
      )
    );
  }

  const companyId = companyInsert.data?.id;
  if (!companyId) {
    throw redirect(
      path.to.companies,
      await flash(request, error(null, "Failed to get company ID"))
    );
  }

  const seed = await seedCompany(client, companyId, userId, {
    parentCompanyId
  });
  if (seed.error) {
    throw redirect(
      path.to.companies,
      await flash(request, error(seed.error, "Failed to seed company"))
    );
  }

  const locationInsert = await upsertLocation(client, {
    ...locationData,
    name: "Headquarters",
    companyId,
    timezone: getLocalTimeZone(),
    createdBy: userId
  });

  if (locationInsert.error) {
    throw redirect(
      path.to.companies,
      await flash(
        request,
        error(locationInsert.error, "Failed to create headquarters location")
      )
    );
  }

  const locationId = locationInsert.data?.id;
  if (!locationId) {
    throw redirect(
      path.to.companies,
      await flash(request, error(null, "Failed to get location ID"))
    );
  }

  const job = await insertEmployeeJob(client, {
    id: userId,
    companyId,
    locationId
  });

  if (job.error) {
    throw redirect(
      path.to.companies,
      await flash(
        request,
        error(job.error, "Failed to create employee job record")
      )
    );
  }

  throw redirect(
    path.to.companies,
    await flash(request, success("Created company"))
  );
}

export default function NewSubsidiaryRoute() {
  const navigate = useNavigate();
  const { company } = useUser();

  const initialValues = {
    parentCompanyId: company?.id ?? undefined,
    name: "",
    taxId: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    countryCode: "",
    baseCurrencyCode: company?.baseCurrencyCode ?? "USD"
  };

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) navigate(path.to.companies);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Let's setup your new company</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <SubsidiaryCompanyForm
            company={initialValues}
            parentCompanyId={company?.id ?? undefined}
          />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
