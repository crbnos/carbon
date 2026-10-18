// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useLocale } from "@react-aria/i18n";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteTimeCardEntry } from "~/modules/people/people.service";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "people",
    role: "employee"
  });
  const api = carbonFor(auth);

  const { entryId } = params;
  if (!entryId) throw notFound("entryId not found");

  const entry = await api.people.getTimeCardEntry({ entryId });
  if (entry.error) {
    throw redirect(
      path.to.peopleTimecard,
      await flash(request, error(entry.error, "Failed to get timecard"))
    );
  }

  return {
    entry: entry.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "people"
  });

  const { entryId } = params;
  if (!entryId) {
    throw redirect(
      path.to.peopleTimecard,
      await flash(request, error(params, "Failed to get entry id"))
    );
  }

  const { error: deleteError } = await deleteTimeCardEntry(client, entryId);
  if (deleteError) {
    throw redirect(
      path.to.peopleTimecard,
      await flash(request, error(deleteError, "Failed to delete timecard"))
    );
  }

  throw redirect(
    path.to.peopleTimecard,
    await flash(request, success("Successfully deleted timecard"))
  );
}

export default function DeleteTimecardRoute() {
  const { entryId } = useParams();
  const { entry } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();
  const { locale } = useLocale();

  if (!entry) return null;
  if (!entryId) throw new Error("entryId is not found");

  const onCancel = () => navigate(path.to.peopleTimecard);

  const clockIn = new Date(entry.clockIn).toLocaleString(locale);
  return (
    <ConfirmDelete
      action={path.to.deleteTimecard(entryId)}
      name={`Timecard (${clockIn})`}
      text={t`Are you sure you want to delete this timecard? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
