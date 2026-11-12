// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { ValidatedForm } from "@carbon/form";
import {
  Button,
  HStack,
  ModalDrawer,
  ModalDrawerBody,
  ModalDrawerContent,
  ModalDrawerFooter,
  ModalDrawerHeader,
  ModalDrawerProvider,
  ModalDrawerTitle,
  toast,
  VStack
} from "@carbon/react";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestResponse } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import type { z } from "zod";
import {
  Customer,
  CustomFormFields,
  DatePicker,
  Hidden,
  Submit
} from "~/components/Form";
import { useCompanyToday, usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { customerPortalValidator } from "../../sales.models";
import { customerPortalEarliestExpiry } from "../../sales.utils";

type CustomerPortalFormProps = {
  initialValues: z.infer<typeof customerPortalValidator>;
  releaseOptions?: {
    files: { id: string; name: string; sourceLabel: string }[];
    releases: {
      id: string;
      title: string;
      documentType: string;
      createdAt: string;
    }[];
  } | null;
  type?: "modal" | "drawer";
  open?: boolean;
  onClose: () => void;
};

const CustomerPortalForm = ({
  initialValues,
  releaseOptions,
  open = true,
  type = "drawer",
  onClose
}: CustomerPortalFormProps) => {
  const { t } = useLingui();
  const permissions = usePermissions();
  const fetcher = useFetcher<PostgrestResponse<{ id: string }>>();
  const releaseFetcher = useFetcher<{
    released?: boolean;
    releaseError?: string;
  }>();
  const [section, setSection] = useState<"settings" | "documents">("settings");

  useEffect(() => {
    if (type !== "modal") return;

    if (fetcher.state === "loading" && fetcher.data?.data) {
      onClose?.();
      toast.success(t`Created customer portal`);
    } else if (fetcher.state === "idle" && fetcher.data?.error) {
      toast.error(
        t`Failed to create customer portal: ${fetcher.data.error.message}`
      );
    }
  }, [fetcher.data, fetcher.state, onClose, t, type]);

  const isEditing = initialValues.id !== undefined;
  const earliestExpiry = parseDate(
    customerPortalEarliestExpiry(useCompanyToday(), initialValues.expiresOn)
  );

  const isDisabled = isEditing
    ? !permissions.can("update", "sales")
    : !permissions.can("create", "sales");

  return (
    <ModalDrawerProvider type={type}>
      <ModalDrawer
        open={open}
        onOpenChange={(open) => {
          if (!open) onClose?.();
        }}
      >
        <ModalDrawerContent>
          {isEditing && (
            <div className="flex gap-2 px-6 pt-4">
              <Button
                type="button"
                size="sm"
                variant={section === "settings" ? "primary" : "secondary"}
                onClick={() => setSection("settings")}
              >
                <Trans>Settings</Trans>
              </Button>
              <Button
                type="button"
                size="sm"
                variant={section === "documents" ? "primary" : "secondary"}
                onClick={() => setSection("documents")}
              >
                <Trans>Released documents</Trans>
              </Button>
            </div>
          )}
          {section === "settings" ? (
            <ValidatedForm
              validator={customerPortalValidator}
              method="post"
              action={
                isEditing
                  ? path.to.customerPortal(initialValues.id!)
                  : path.to.newCustomerPortal
              }
              defaultValues={initialValues}
              fetcher={fetcher}
              className="flex flex-col h-full"
            >
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  {isEditing ? <Trans>Edit</Trans> : <Trans>New</Trans>}{" "}
                  <Trans>Customer Portal</Trans>
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>
                <Hidden name="id" />
                <Hidden name="type" value={type} />
                <VStack spacing={4}>
                  <Customer
                    name="customerId"
                    label={t`Customer`}
                    termId="customer-portal-customer"
                  />
                  <DatePicker
                    name="expiresOn"
                    minValue={earliestExpiry}
                    label={t`Expires On`}
                    helperText={t`The link stops working on this day. Leave blank to keep it open.`}
                  />
                  <CustomFormFields table="externalLink" />
                </VStack>
              </ModalDrawerBody>
              <ModalDrawerFooter>
                <HStack>
                  <Submit isDisabled={isDisabled}>
                    <Trans>Save</Trans>
                  </Submit>
                  <Button size="md" variant="solid" onClick={() => onClose()}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalDrawerFooter>
            </ValidatedForm>
          ) : (
            <releaseFetcher.Form
              method="post"
              action={path.to.customerPortal(initialValues.id!)}
              className="flex flex-col h-full"
            >
              <ModalDrawerHeader>
                <ModalDrawerTitle>
                  <Trans>Release a customer document</Trans>
                </ModalDrawerTitle>
              </ModalDrawerHeader>
              <ModalDrawerBody>
                <input type="hidden" name="intent" value="releaseDocument" />
                <VStack spacing={4}>
                  <p className="text-sm text-muted-foreground">
                    <Trans>
                      Select a PDF attached to this customer's order or posted
                      shipment. Only released PDFs appear in the portal.
                    </Trans>
                  </p>
                  <label
                    className="flex flex-col gap-2 text-sm font-medium"
                    htmlFor="portal-release-file"
                  >
                    <Trans>Attached PDF</Trans>
                    <select
                      id="portal-release-file"
                      name="documentId"
                      required
                      defaultValue=""
                      className="h-10 w-full rounded-md border border-input bg-background px-3"
                    >
                      <option value="" disabled>
                        <Trans>Select a PDF</Trans>
                      </option>
                      {releaseOptions?.files.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.sourceLabel} — {file.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className="flex flex-col gap-2 text-sm font-medium"
                    htmlFor="portal-release-type"
                  >
                    <Trans>Document type</Trans>
                    <select
                      id="portal-release-type"
                      name="documentType"
                      className="h-10 w-full rounded-md border border-input bg-background px-3"
                    >
                      <option value="CoC">
                        <Trans>Certificate of Conformance</Trans>
                      </option>
                      <option value="Test Report">
                        <Trans>Test report</Trans>
                      </option>
                    </select>
                  </label>
                  {releaseFetcher.data?.releaseError && (
                    <p role="alert" className="text-sm text-destructive">
                      {releaseFetcher.data.releaseError}
                    </p>
                  )}
                  {releaseFetcher.data?.released && (
                    <p role="status" className="text-sm text-emerald-600">
                      <Trans>Document released to the portal.</Trans>
                    </p>
                  )}
                  {releaseOptions?.releases.length ? (
                    <div className="w-full space-y-2">
                      <h3 className="text-sm font-medium">
                        <Trans>Already released</Trans>
                      </h3>
                      {releaseOptions.releases.map((release) => (
                        <div
                          key={release.id}
                          className="rounded-md border p-2 text-sm"
                        >
                          {release.documentType}: {release.title}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </VStack>
              </ModalDrawerBody>
              <ModalDrawerFooter>
                <HStack>
                  <Button
                    type="submit"
                    size="md"
                    variant="primary"
                    isDisabled={
                      isDisabled ||
                      !releaseOptions?.files.length ||
                      releaseFetcher.state !== "idle"
                    }
                  >
                    <Trans>Release PDF</Trans>
                  </Button>
                  <Button size="md" variant="solid" onClick={() => onClose()}>
                    <Trans>Cancel</Trans>
                  </Button>
                </HStack>
              </ModalDrawerFooter>
            </releaseFetcher.Form>
          )}
        </ModalDrawerContent>
      </ModalDrawer>
    </ModalDrawerProvider>
  );
};

export default CustomerPortalForm;
