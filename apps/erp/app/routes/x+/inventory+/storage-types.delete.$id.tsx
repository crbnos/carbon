// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import {
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  ModalTitle,
  useCloseRoute
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { Trans, useLingui } from "@lingui/react/macro";
import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { ConfirmDelete } from "~/components/Modals";
import {
  getStorageType,
  getStorageTypeUsage
} from "~/modules/inventory/inventory.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const storageType = await getStorageType(client, id);
  if (storageType.error) {
    throw redirect(
      path.to.storageTypes,
      await flash(
        request,
        error(storageType.error, "Failed to get storage type")
      )
    );
  }

  const usage = await getStorageTypeUsage(client, id, companyId);

  return {
    storageType: storageType.data,
    usageCount: usage.count ?? 0,
    sampleUnits: usage.data ?? []
  };
}

// The cascade modal sends `cascade=true` to take the type off its storage units.
const deleteForm = z.object({
  cascade: zfd.checkbox({ trueValue: "true" })
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(deleteForm).request(args, { params: ["id"] });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.inventory.deleteStorageTypeWithCascade({
    id: input.params.id,
    cascade: input.data.cascade
  });
  return respond(args.request, result).redirect(path.to.storageTypes, {
    message: "Successfully deleted storage type",
    onError: `${path.to.storageTypes}?${getParams(args.request)}`
  });
}

export default function DeleteStorageTypeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const { storageType, usageCount, sampleUnits } =
    useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();
  const { t } = useLingui();

  if (!storageType) return null;

  const onCancel = () => closeRoute();

  if (usageCount === 0) {
    return (
      <ConfirmDelete
        action={path.to.deleteStorageType(id)}
        name={storageType.name}
        text={t`Are you sure you want to delete the storage type: ${storageType.name}? This cannot be undone.`}
        onCancel={onCancel}
      />
    );
  }

  return (
    <CascadeConfirmDelete
      action={path.to.deleteStorageType(id)}
      name={storageType.name}
      usageCount={usageCount}
      sampleUnits={sampleUnits}
      onCancel={onCancel}
    />
  );
}

type CascadeConfirmDeleteProps = {
  action: string;
  name: string;
  usageCount: number;
  sampleUnits: { id: string; name: string }[];
  onCancel: () => void;
};

function CascadeConfirmDelete({
  action,
  name,
  usageCount,
  sampleUnits,
  onCancel
}: CascadeConfirmDeleteProps) {
  const { t } = useLingui();
  const fetcher = useFetcher<{}>();
  const [cascade, setCascade] = useState(false);
  const remaining = usageCount - sampleUnits.length;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t`Delete ${name}`}</ModalTitle>
        </ModalHeader>

        <ModalBody>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              <Trans>
                This storage type is currently used by {usageCount} storage unit
                {usageCount === 1 ? "" : "s"}.
              </Trans>
            </p>
            {sampleUnits.length > 0 && (
              <ul className="list-disc pl-5 text-muted-foreground">
                {sampleUnits.map((u) => (
                  <li key={u.id}>{u.name}</li>
                ))}
                {remaining > 0 && (
                  <li>
                    <Trans>and {remaining} more</Trans>
                  </li>
                )}
              </ul>
            )}
            <fetcher.Form
              id="cascade-delete-form"
              method="post"
              action={action}
            >
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  name="cascade"
                  value="true"
                  isChecked={cascade}
                  onCheckedChange={(c) => setCascade(c === true)}
                  className="mt-0.5"
                />
                <span>
                  <Trans>
                    Remove this storage type from all referencing storage units
                    and delete it. This cannot be undone.
                  </Trans>
                </span>
              </label>
            </fetcher.Form>
          </div>
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            variant="destructive"
            type="submit"
            form="cascade-delete-form"
            isDisabled={!cascade || fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
          >
            <Trans>Delete</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
