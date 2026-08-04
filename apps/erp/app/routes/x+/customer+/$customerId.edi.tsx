import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useParams } from "react-router";
import {
  deleteEdiTradingPartnerLocation,
  ediTradingPartnerLocationValidator,
  ediTradingPartnerValidator,
  ensureEdiEventSubscriptions,
  getCustomerLocations,
  getEdiTradingPartner,
  upsertEdiTradingPartner,
  upsertEdiTradingPartnerDocuments,
  upsertEdiTradingPartnerLocation
} from "~/modules/sales";
import { CustomerEdiForm } from "~/modules/sales/ui/Customer";
import { ediDocumentDefinitions } from "~/modules/sales/ui/Customer/CustomerEdiForm";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const [partner, customerLocations] = await Promise.all([
    getEdiTradingPartner(client, customerId, companyId),
    getCustomerLocations(client, customerId)
  ]);

  if (partner.error) {
    throw redirect(
      path.to.customer(customerId),
      await flash(request, error(partner.error, "Failed to load EDI settings"))
    );
  }

  return {
    partner: partner.data,
    customerLocations: customerLocations.data ?? []
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "location") {
    const validation = await validator(
      ediTradingPartnerLocationValidator
    ).validate(formData);
    if (validation.error) return validationError(validation.error);

    const { id: locationId, ...locationData } = validation.data;
    if (locationId) {
      const update = await upsertEdiTradingPartnerLocation(client, {
        ...locationData,
        id: locationId,
        updatedBy: userId
      });
      if (update.error) {
        return data(
          {},
          await flash(
            request,
            error(update.error, "Failed to update location mapping")
          )
        );
      }
    } else {
      const partner = await getEdiTradingPartner(client, customerId, companyId);
      if (partner.error || !partner.data) {
        return data(
          {},
          await flash(
            request,
            error(
              partner.error,
              "Save EDI settings before adding a location mapping"
            )
          )
        );
      }
      const insert = await upsertEdiTradingPartnerLocation(client, {
        ...locationData,
        tradingPartnerId: partner.data.id,
        companyId,
        createdBy: userId
      });
      if (insert.error) {
        return data(
          {},
          await flash(
            request,
            error(insert.error, "Failed to add location mapping")
          )
        );
      }
    }

    throw redirect(
      path.to.customerEdi(customerId),
      await flash(request, success("Location mapping saved"))
    );
  }

  if (intent === "deleteLocation") {
    const id = formData.get("id") as string;
    const del = await deleteEdiTradingPartnerLocation(client, id, companyId);
    if (del.error) {
      return data(
        {},
        await flash(
          request,
          error(del.error, "Failed to delete location mapping")
        )
      );
    }
    throw redirect(
      path.to.customerEdi(customerId),
      await flash(request, success("Location mapping removed"))
    );
  }

  // Default: the trading-partner settings form.
  const validation = await validator(ediTradingPartnerValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { id, documents: _documents, ...rest } = validation.data;
  const upsert = await upsertEdiTradingPartner(
    client,
    id
      ? { ...rest, id, updatedBy: userId }
      : { ...rest, companyId, createdBy: userId }
  );
  if (upsert.error || !upsert.data) {
    return data(
      {},
      await flash(request, error(upsert.error, "Failed to update EDI settings"))
    );
  }

  const tradingPartnerId = upsert.data.id;
  const enabledKeys = new Set(validation.data.documents ?? []);
  const documents = ediDocumentDefinitions.map((doc) => ({
    documentType: doc.documentType,
    direction: doc.direction,
    enabled: enabledKeys.has(doc.key)
  }));

  const docsResult = await upsertEdiTradingPartnerDocuments(
    client,
    tradingPartnerId,
    companyId,
    documents,
    userId
  );
  if (docsResult.error) {
    return data(
      {},
      await flash(
        request,
        error(docsResult.error, "Failed to update EDI documents")
      )
    );
  }

  if (rest.active === true) {
    await ensureEdiEventSubscriptions(getCarbonServiceRole(), companyId);
  }

  throw redirect(
    path.to.customerEdi(customerId),
    await flash(request, success("EDI settings updated"))
  );
}

export default function CustomerEdiRoute() {
  const { partner, customerLocations } = useLoaderData<typeof loader>();
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");

  const initialValues = {
    id: partner?.id,
    customerId,
    externalId: partner?.externalId ?? "",
    active: partner?.active ?? false,
    releaseMode: (partner?.releaseMode ?? "Review") as "Automatic" | "Review",
    priceTolerancePercent: partner?.priceTolerancePercent ?? 0,
    documents: (partner?.ediTradingPartnerDocument ?? [])
      .filter((doc) => doc.enabled)
      .map((doc) => `${doc.documentType}:${doc.direction}`)
  };

  return (
    <CustomerEdiForm
      customerId={customerId}
      initialValues={initialValues}
      locations={partner?.ediTradingPartnerLocation ?? []}
      customerLocations={customerLocations}
    />
  );
}
