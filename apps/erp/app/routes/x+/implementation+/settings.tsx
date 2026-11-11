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
import type { ImplementationHubVersion } from "~/modules/shared/shared.models";
import { implementationHub2Enabled } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import type { action as versionAction } from "./version";

const logger = getLogger("erp", "implementation-settings");

export const handle: Handle = {
  breadcrumb: msg`Settings`,
  to: path.to.implementationSettings
};

// Carbon staff only: whether the company is enrolled, the Implementation Hub
// version staff chose for it, and whether Implementation Hub 2.0 is on for it
// (the flag).
export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, email } = await requirePermissions(request, {});
  if (!isInternalEmail(email)) {
    throw redirect(path.to.implementation);
  }

  // Invites have no read policy, so the people are read the way the Employees
  // screen reads them, to count who would see an empty page after a switch.
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
    implementationHub2Enabled(companyId)
  ]);
  if (employees.error) {
    logger.error(
      "Failed to load the people for the Implementation Hub settings",
      {
        companyId,
        error: employees.error
      }
    );
  }

  const withPage = new Set((members.data ?? []).map((m) => m.userId));
  const withoutPage = (employees.data ?? []).filter(
    (person) =>
      person.id &&
      person.status === "Active" &&
      !isInternalEmail(person.email ?? "") &&
      !withPage.has(person.id)
  ).length;

  // The version staff chose. Its people get Implementation Hub 2.0 only while
  // the flag is on for the company as well (`usesImplementationHub2`).
  const hubVersion: ImplementationHubVersion | null = hub.data
    ? hub.data.hubVersion === "2.0"
      ? "2.0"
      : "1.0"
    : null;

  return {
    enrolled: Boolean(hub.data),
    hubVersion,
    flagOn,
    withoutPage
  };
}

export default function ImplementationSettingsRoute() {
  const { enrolled, hubVersion, flagOn, withoutPage } =
    useLoaderData<typeof loader>();

  return (
    <ScrollArea className="h-full w-full">
      <SettingsPage className="gap-4">
        <SettingsPageHeading>
          <Trans>Implementation Hub Settings</Trans>
        </SettingsPageHeading>
        <EnrolmentCard enrolled={enrolled} flagOn={flagOn} />
        <VersionCard
          hubVersion={enrolled ? hubVersion : null}
          flagOn={flagOn}
          withoutPage={withoutPage}
        />
      </SettingsPage>
    </ScrollArea>
  );
}

// Enrolment is when the Implementation Hub becomes visible to the company's own
// people. It starts on 2.0 only while Implementation Hub 2.0 is on for the
// company.
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
              The company's people do not see the Implementation Hub yet.
              Enrolling shows them Implementation Hub 2.0 and emails the
              company's admins.
            </Trans>
          ) : (
            <Trans>
              The company's people do not see the Implementation Hub yet.
              Enrolling shows them Implementation Hub 1.0, because
              Implementation Hub 2.0 is off for this company, and emails the
              company's admins.
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

// Which Implementation Hub version the company uses, and the switch to the
// other one. Switching needs permission to update settings in the company;
// both versions read the same hub records, so nothing moves. 2.0 also needs
// the flag on for the company, which is set outside the app.
function VersionCard({
  hubVersion,
  flagOn,
  withoutPage
}: {
  hubVersion: ImplementationHubVersion | null;
  flagOn: boolean;
  withoutPage: number;
}) {
  const { t } = useLingui();
  const permissions = usePermissions();
  const canSwitch = permissions.can("update", "settings");
  const confirm = useDisclosure();
  const fetcher = useAction<typeof versionAction>({
    onSuccess: confirm.onClose
  });
  const next: ImplementationHubVersion = hubVersion === "2.0" ? "1.0" : "2.0";
  const title =
    next === "2.0"
      ? t`Switch to Implementation Hub 2.0`
      : t`Switch to Implementation Hub 1.0`;
  // Off for the company: 2.0 cannot be chosen, and 2.0 already chosen waits,
  // its people on Implementation Hub 1.0.
  const blocked = next === "2.0" && !flagOn;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>
            <Trans>Version</Trans>
          </CardTitle>
          {hubVersion ? (
            <Badge variant="outline">
              {hubVersion === "2.0" ? (
                <Trans>Implementation Hub 2.0</Trans>
              ) : (
                <Trans>Implementation Hub 1.0</Trans>
              )}
            </Badge>
          ) : null}
        </div>
        <CardDescription className="text-pretty">
          {hubVersion === null ? (
            <Trans>The company gets a version when it is enrolled.</Trans>
          ) : hubVersion === "2.0" && !flagOn ? (
            <Trans>
              Its people see Implementation Hub 1.0 while Implementation Hub 2.0
              is off for this company. Their pages stay.
            </Trans>
          ) : hubVersion === "2.0" ? (
            <Trans>
              Its people see the page loaded for them in Implementation Hub 2.0.
            </Trans>
          ) : (
            <Trans>
              Its people see Implementation Hub 1.0, not these pages, until you
              switch.
            </Trans>
          )}
        </CardDescription>
      </CardHeader>
      {hubVersion ? (
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
                Implementation Hub 2.0 is off for this company. Add it to the
                implementation-hub-2 flag in the CSA dashboard first.
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
      <Modal
        open={confirm.isOpen}
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
              {next === "2.0" ? (
                <p>
                  <Trans>
                    The company's people will see the page loaded for them in
                    Implementation Hub 2.0 instead of Implementation Hub 1.0.
                    Ticks, answers and rows carry over.
                  </Trans>
                </p>
              ) : (
                <p>
                  <Trans>
                    The company's people will see Implementation Hub 1.0 again.
                    Their pages stay, so you can switch back.
                  </Trans>
                </p>
              )}
              {next === "2.0" && withoutPage > 0 ? (
                <p className="text-foreground">
                  <Plural
                    value={withoutPage}
                    one="# active person has no page yet and will see an empty page until you load one."
                    other="# active people have no page yet and will see an empty page until you load one."
                  />
                </p>
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={confirm.onClose}>
              <Trans>Cancel</Trans>
            </Button>
            <fetcher.Form method="post" action={path.to.implementationVersion}>
              <input type="hidden" name="hubVersion" value={next} />
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
    </Card>
  );
}
