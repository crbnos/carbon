// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  IntegrationConnectError,
  startIntegrationConnect
} from "@carbon/ee/integrations/connect";
import {
  connectionUsable,
  type IntegrationConnection,
  needsReconnect
} from "@carbon/ee/integrations/connections";
import { useAction } from "@carbon/query";
import {
  Badge,
  Button,
  DrawerBody,
  HStack,
  Input,
  toast,
  toastError,
  VStack
} from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { LuPlug, LuUnplug } from "react-icons/lu";
import { getIntegrationError } from "~/modules/settings/integration-errors";
import { path } from "~/utils/path";
import { suggestConnectionName } from "./connectionName";

/** Derived, not restated: the loader hands these rows straight through, so a column
 * that changes type upstream fails here rather than rendering something else. */
export type ConnectionRow = Pick<
  IntegrationConnection,
  "id" | "pieceName" | "name" | "accountLabel" | "status" | "metadata"
>;

// Keyed by the SAME status the shared predicate reads, so the badge cannot say
// one thing while `connectionUsable` says another.
const STATUS_VARIANT = {
  Active: "green",
  Expired: "yellow",
  Revoked: "red"
} as const;

const STATUS_LABEL = {
  Active: msg`Active`,
  Expired: msg`Expired`,
  Revoked: msg`Revoked`
} satisfies Record<keyof typeof STATUS_VARIANT, unknown>;

/**
 * The accounts this integration can act as, inside its own card's Details drawer.
 *
 * Every other integration installs once per company; this one allows several named
 * accounts, because a workflow step picks which one it runs as. That is the only
 * difference, and it is why the list lives here rather than on the settings form.
 */
export function ConnectionsTab({
  tabs,
  pieceName,
  defaultName,
  connections,
  requiredScopes
}: {
  tabs?: ReactNode;
  pieceName: string;
  /** Seeds the name field, so the common case is one click. */
  defaultName: string;
  connections: ConnectionRow[];
  /** What a connection must hold for this piece's steps (`requiredScopesFor`). */
  requiredScopes: readonly string[];
}) {
  const { t, i18n } = useLingui();
  const [name, setName] = useState("");
  const [connecting, setConnecting] = useState(false);

  // The default is the app's own name, so the SECOND account always collided with
  // the first — leaving the button disabled and the field showing a name the user
  // never typed, with nothing explaining what to do. Suggest a free one instead.
  const taken = useMemo(
    () => new Set(connections.map((connection) => connection.name)),
    [connections]
  );
  const suggested = useMemo(
    () => suggestConnectionName(defaultName, taken),
    [defaultName, taken]
  );

  const proposed = name.trim() || suggested;
  // Only what the user actually TYPED can collide — the suggestion never does.
  const duplicate = name.trim() !== "" && taken.has(proposed);

  // The consent screen opens from the URL the connect loader builds; the same
  // response sets the state cookie the callback checks.
  // One entry point for Add account (`?name=`) and Reconnect (`?connection=`).
  const startConnect = async (
    query: { name: string } | { connection: string }
  ) => {
    setConnecting(true);
    try {
      await startIntegrationConnect(
        `${path.to.api.integrationConnect(pieceName)}?${new URLSearchParams(
          query
        )}`
      );
    } catch (error) {
      const failure =
        error instanceof IntegrationConnectError
          ? getIntegrationError("connection", error.code)
          : undefined;
      if (failure) {
        toast.error(i18n._(failure.title), {
          description: i18n._(failure.description)
        });
      } else {
        toastError(t`Couldn't start the authorization.`, error);
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <DrawerBody className="gap-4">
      {tabs}
      <VStack spacing={4}>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Accounts your workflows can act as. Add one for each account a
            workflow step should use.
          </Trans>
        </p>

        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans>No accounts connected yet.</Trans>
          </p>
        ) : (
          <VStack spacing={2} className="w-full">
            {connections.map((connection) => (
              <ConnectionItem
                key={connection.id}
                connection={connection}
                requiredScopes={requiredScopes}
                reconnecting={connecting}
                onReconnect={() => startConnect({ connection: connection.id })}
              />
            ))}
          </VStack>
        )}

        <HStack spacing={2} className="w-full">
          <Input
            size="sm"
            className="max-w-64"
            value={name}
            placeholder={suggested}
            aria-label={t`Connection name`}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            size="sm"
            leftIcon={<LuPlug />}
            isDisabled={duplicate}
            isLoading={connecting}
            onClick={() => startConnect({ name: proposed })}
          >
            <Trans>Add account</Trans>
          </Button>
          {duplicate && (
            <span className="text-sm text-destructive">
              <Trans>
                An account is already called that — pick a different name.
              </Trans>
            </span>
          )}
        </HStack>
      </VStack>
    </DrawerBody>
  );
}

function ConnectionItem({
  connection,
  requiredScopes,
  reconnecting,
  onReconnect
}: {
  connection: ConnectionRow;
  requiredScopes: readonly string[];
  reconnecting: boolean;
  onReconnect: () => void;
}) {
  const { t, i18n } = useLingui();
  // What the user is typing, until the rename settles; the stored name otherwise,
  // so a refused rename shows the name the account still has.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? connection.name;
  const renamer = useAction({
    onSuccess: () => toast.success(t`Renamed`),
    onSettled: () => setDraft(null)
  });
  const disconnecter = useAction({
    onSuccess: () => toast.success(t`Disconnected`)
  });
  const pending = renamer.isPending || disconnecter.isPending;
  const usable = connectionUsable(connection);
  // Connected before this piece needed a scope (a Slack workspace installed for the
  // Assistant, say). Everything it already did keeps working; workflow steps do not.
  const needsScopes = needsReconnect(connection, requiredScopes);

  return (
    <HStack className="w-full items-start justify-between gap-3 border rounded-md p-3">
      <VStack spacing={1} className="min-w-0 flex-1">
        <HStack spacing={2} className="w-full">
          <Input
            size="sm"
            className="min-w-0 flex-1"
            value={name}
            aria-label={t`Connection name`}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              if (name.trim() === "" || name === connection.name) {
                setDraft(null);
                return;
              }
              renamer.submit(
                { intent: "rename", id: connection.id, name: name.trim() },
                { method: "post", action: path.to.integrationConnections }
              );
            }}
          />
          <Badge
            variant={STATUS_VARIANT[connection.status]}
            className="shrink-0"
          >
            {i18n._(STATUS_LABEL[connection.status])}
          </Badge>
          {needsScopes && (
            <Badge variant="yellow" className="shrink-0">
              <Trans>Reconnect needed</Trans>
            </Badge>
          )}
        </HStack>
        {connection.accountLabel && (
          <span className="text-xs text-muted-foreground">
            {connection.accountLabel}
          </span>
        )}
        {needsScopes ? (
          <span className="text-xs text-muted-foreground">
            <Trans>
              Connected before workflows needed extra permissions. Reconnect to
              grant them — everything else keeps working meanwhile.
            </Trans>
          </span>
        ) : !usable ? (
          <span className="text-xs text-muted-foreground">
            <Trans>
              This account has stopped working. Reconnect it — workflow steps
              using it will fail until you do.
            </Trans>
          </span>
        ) : null}
      </VStack>
      <VStack spacing={2} className="w-auto shrink-0 items-end">
        {(needsScopes || !usable) && (
          <Button
            size="sm"
            leftIcon={<LuPlug />}
            isLoading={reconnecting}
            onClick={onReconnect}
          >
            <Trans>Reconnect</Trans>
          </Button>
        )}
        <disconnecter.Form
          method="post"
          action={path.to.integrationConnections}
          className="shrink-0"
        >
          <input type="hidden" name="intent" value="disconnect" />
          <input type="hidden" name="id" value={connection.id} />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            leftIcon={<LuUnplug />}
            isDisabled={connection.status === "Revoked" || pending}
            isLoading={disconnecter.isPending}
          >
            <Trans>Disconnect</Trans>
          </Button>
        </disconnecter.Form>
      </VStack>
    </HStack>
  );
}
