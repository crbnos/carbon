// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getImplementationHub,
  getImplementationMembers
} from "@carbon/implementation-hub/server";
import { getLogger } from "@carbon/logger";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ScrollArea,
  useDisclosure
} from "@carbon/react";
import { isInternalEmail, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { LuArrowLeftRight, LuRocket } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { SettingsPage, SettingsPageHeading } from "~/components/SettingsPage";
import { usePermissions } from "~/hooks";
import type { ImplementationLayout } from "~/modules/shared/shared.models";
import { personalPagesEnabled } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import type { action as layoutAction } from "./layout";

const logger = getLogger("erp", "implementation-settings");

export const handle: Handle = {
  breadcrumb: msg`Settings`,
  to: path.to.implementationSettings
};

// Carbon staff only: whether the company is enrolled, the hub layout staff
// chose for it, and whether the new hub is on for it (the flag).
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {});
  if (!isInternalEmail(email)) {
    throw redirect(path.to.implementation);
  }

  // Invites have no read policy, so the people are read the way the Employees
  // screen reads them, to count who would see an empty hub after a switch.
  const { client: peopleClient } = await requirePermissions(request, {
    role: "employee",
    bypassRls: true
  });
  const [hub, members, employees, flagOn] = await Promise.all([
    getImplementationHub(client, companyId),
    getImplementationMembers(client, companyId),
    peopleClient
      .from("employees")
      .select("id, email, status")
      .eq("companyId", companyId),
    personalPagesEnabled(companyId)
  ]);
  if (employees.error) {
    logger.error("Failed to load the people for the hub settings", {
      companyId,
      error: employees.error
    });
  }

  const withPage = new Set((members.data ?? []).map((m) => m.userId));
  const withoutPage = (employees.data ?? []).filter(
    (person) =>
      person.id &&
      person.status === "Active" &&
      !isInternalEmail(person.email ?? "") &&
      !withPage.has(person.id)
  ).length;

  // The layout staff chose. Its people get Personal Pages only while the
  // flag is on for the company as well (`usesPersonalPages`).
  const layout: ImplementationLayout | null = hub.data
    ? hub.data.layout === "Personal Pages"
      ? "Personal Pages"
      : "Company Plan"
    : null;

  return {
    enrolled: Boolean(hub.data),
    layout,
    flagOn,
    withoutPage
  };
}

export default function ImplementationSettingsRoute() {
  const { enrolled, layout, flagOn, withoutPage } =
    useLoaderData<typeof loader>();

  return (
    <ScrollArea className="h-full w-full">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Hub Settings</Trans>
        </SettingsPageHeading>
        <EnrolmentCard enrolled={enrolled} flagOn={flagOn} />
        <LayoutCard
          layout={enrolled ? layout : null}
          flagOn={flagOn}
          withoutPage={withoutPage}
        />
      </SettingsPage>
    </ScrollArea>
  );
}

// Enrolment is when the hub becomes visible to the company's own people. It
// starts on Personal Pages only while the new hub is on for the company.
function EnrolmentCard({
  enrolled,
  flagOn
}: {
  enrolled: boolean;
  flagOn: boolean;
}) {
  const fetcher = useFetcher();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>
            <Trans>Enrolment</Trans>
          </CardTitle>
          {enrolled ? (
            <Badge variant="green">
              <Trans>Enrolled</Trans>
            </Badge>
          ) : (
            <Badge variant="outline">
              <Trans>Not enrolled</Trans>
            </Badge>
          )}
        </div>
        <CardDescription className="text-pretty">
          {enrolled ? (
            <Trans>The company's people see the Implementation Hub.</Trans>
          ) : flagOn ? (
            <Trans>
              The company's people do not see the hub yet. Enrolling shows it to
              them, on Personal Pages, and emails the company's admins.
            </Trans>
          ) : (
            <Trans>
              The company's people do not see the hub yet. Enrolling shows them
              the Company Plan hub, because the new hub is off for this company,
              and emails the company's admins.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      {enrolled ? null : (
        <CardContent>
          <fetcher.Form method="post" action={path.to.implementationEnroll}>
            <Button
              type="submit"
              leftIcon={<LuRocket />}
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
            >
              <Trans>Enroll company</Trans>
            </Button>
          </fetcher.Form>
        </CardContent>
      )}
    </Card>
  );
}

// Which layout the company uses, and the switch to the other one. Switching
// needs permission to update settings in the company; both layouts read the
// same hub records, so nothing moves. Personal Pages also needs the new hub
// on for the company (the flag), which is set outside the app.
function LayoutCard({
  layout,
  flagOn,
  withoutPage
}: {
  layout: ImplementationLayout | null;
  flagOn: boolean;
  withoutPage: number;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canSwitch = permissions.can("update", "settings");
  const confirm = useDisclosure();
  const fetcher = useAction<typeof layoutAction>({
    onSuccess: confirm.onClose
  });
  const next: ImplementationLayout =
    layout === "Personal Pages" ? "Company Plan" : "Personal Pages";
  const title =
    next === "Personal Pages"
      ? t`Switch to Personal Pages`
      : t`Switch to Company Plan`;
  // Off for the company: Personal Pages cannot be chosen, and one already
  // chosen waits, its people on the Company Plan hub.
  const blocked = next === "Personal Pages" && !flagOn;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>
            <Trans>Layout</Trans>
          </CardTitle>
          {layout ? <Badge variant="outline">{layout}</Badge> : null}
        </div>
        <CardDescription className="text-pretty">
          {layout === null ? (
            <Trans>The company chooses a layout when it is enrolled.</Trans>
          ) : layout === "Personal Pages" && !flagOn ? (
            <Trans>
              Its people see the Company Plan hub while the new hub is off for
              this company. Their pages stay.
            </Trans>
          ) : layout === "Personal Pages" ? (
            <Trans>Its people see the page loaded for them in this hub.</Trans>
          ) : (
            <Trans>
              Its people see the Company Plan hub, not these pages, until you
              switch.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      {layout ? (
        <CardContent className="flex flex-col items-start gap-2">
          <Button
            variant="secondary"
            leftIcon={<LuArrowLeftRight />}
            isDisabled={!canSwitch || blocked}
            onClick={confirm.onOpen}
          >
            {title}
          </Button>
          {blocked ? (
            <p className="text-xs text-muted-foreground text-pretty">
              <Trans>
                The new hub is off for this company. Add it to the
                implementation-hub-personal-pages flag in the CSA dashboard
                first.
              </Trans>
            </p>
          ) : null}
          {canSwitch ? null : (
            <p className="text-xs text-muted-foreground">
              <Trans>
                Switching needs permission to update settings in this company.
              </Trans>
            </p>
          )}
        </CardContent>
      ) : null}
      {confirm.isOpen ? (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) confirm.onClose();
          }}
        >
          <ModalContent>
            <ModalHeader>
              <ModalTitle>{title}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div className="flex flex-col gap-2 text-sm text-muted-foreground text-pretty">
                {next === "Personal Pages" ? (
                  <p>
                    <Trans>
                      The company's people will see the page loaded for them
                      here instead of the Company Plan hub. Ticks, answers and
                      rows carry over.
                    </Trans>
                  </p>
                ) : (
                  <p>
                    <Trans>
                      The company's people will see the Company Plan hub again.
                      Their pages stay, so you can switch back.
                    </Trans>
                  </p>
                )}
                {next === "Personal Pages" && withoutPage > 0 ? (
                  <p className="text-foreground">
                    <Plural
                      value={withoutPage}
                      one="# active person has no page yet and will see an empty hub until you load one."
                      other="# active people have no page yet and will see an empty hub until you load one."
                    />
                  </p>
                ) : null}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={confirm.onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <fetcher.Form method="post" action={path.to.implementationLayout}>
                <input type="hidden" name="layout" value={next} />
                <Button
                  type="submit"
                  isLoading={fetcher.isPending}
                  isDisabled={fetcher.isPending}
                >
                  <Trans>Switch</Trans>
                </Button>
              </fetcher.Form>
            </ModalFooter>
          </ModalContent>
        </Modal>
      ) : null}
    </Card>
  );
}
