import type { ConnectRouteResponse } from "@carbon/ee/integrations/connect";
import { openConsentPopup } from "@carbon/ee/integrations/connect";
import {
  connectionUsable,
  type IntegrationConnection,
  needsReconnect
} from "@carbon/ee/integrations/connections";
import {
  Badge,
  Button,
  DrawerBody,
  HStack,
  Input,
  toast,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { LuPlug, LuUnplug } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { suggestConnectionName } from "./connectionName";

/** Derived, not restated: the loader hands these rows straight through, so a column
 * that changes type upstream fails here rather than rendering something else. */
export type ConnectionRow = Pick<
  IntegrationConnection,
  | "id"
  | "pieceName"
  | "name"
  | "accountLabel"
  | "status"
  | "lastError"
  | "metadata"
>;

// Keyed by the SAME status the shared predicate reads, so the badge cannot say
// one thing while `connectionUsable` says another.
const STATUS_VARIANT = {
  Active: "green",
  Expired: "yellow",
  Revoked: "red"
} as const;

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
  const { t } = useLingui();
  const [name, setName] = useState("");
  const connect = useFetcher<ConnectRouteResponse>();

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

  // The consent screen opens from the URL the connect loader builds, so the signed
  // `state` never has to round-trip through the browser's own code.
  // One entry point for Add account AND Reconnect: reconnecting is the same
  // consent under the same name, which revives the row with a fresh grant.
  const startConnect = (connectionName: string) =>
    connect.load(
      `${path.to.api.integrationConnect(
        pieceName
      )}?name=${encodeURIComponent(connectionName)}`
    );

  useEffect(() => {
    if (connect.state !== "idle" || connect.data === undefined) return;
    if (connect.data.error) {
      toast.error(connect.data.error);
      return;
    }
    if (connect.data.url) openConsentPopup(connect.data.url);
  }, [connect.state, connect.data]);

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
                reconnecting={connect.state !== "idle"}
                onReconnect={() => startConnect(connection.name)}
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
            isLoading={connect.state !== "idle"}
            onClick={() => startConnect(proposed)}
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
  const { t } = useLingui();
  const fetcher = useFetcher<{ success?: boolean }>();
  const [name, setName] = useState(connection.name);
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
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              if (name.trim() === "" || name === connection.name) {
                setName(connection.name);
                return;
              }
              fetcher.submit(
                { intent: "rename", id: connection.id, name: name.trim() },
                { method: "post", action: path.to.integrationConnections }
              );
            }}
          />
          <Badge
            variant={STATUS_VARIANT[connection.status]}
            className="shrink-0"
          >
            {connection.status}
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
        {connection.lastError && (
          <span className="break-words text-xs text-destructive">
            {connection.lastError}
          </span>
        )}
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
        <fetcher.Form
          method="post"
          action={path.to.integrationConnections}
          className="shrink-0"
        >
          <input type="hidden" name="intent" value="disconnect" />
          <input type="hidden" name="id" value={connection.id} />
          {/* The card's health badge is cached per piece; disconnecting has to drop
            that entry or Settings keeps reporting "Healthy" for an app the builder
            already treats as disconnected. */}
          <input type="hidden" name="pieceName" value={connection.pieceName} />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            leftIcon={<LuUnplug />}
            isDisabled={
              connection.status === "Revoked" || fetcher.state !== "idle"
            }
            isLoading={fetcher.state !== "idle"}
          >
            <Trans>Disconnect</Trans>
          </Button>
        </fetcher.Form>
      </VStack>
    </HStack>
  );
}
