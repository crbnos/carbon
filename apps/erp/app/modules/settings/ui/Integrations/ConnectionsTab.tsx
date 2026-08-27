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
import { useEffect, useState } from "react";
import { LuPlug, LuUnplug } from "react-icons/lu";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";

export type ConnectionRow = {
  id: string;
  pieceName: string;
  name: string;
  accountLabel: string | null;
  status: "Active" | "Expired" | "Revoked";
  lastError: string | null;
};

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
  connections
}: {
  tabs?: ReactNode;
  pieceName: string;
  /** Seeds the name field, so the common case is one click. */
  defaultName: string;
  connections: ConnectionRow[];
}) {
  const { t } = useLingui();
  const [name, setName] = useState("");
  const connect = useFetcher<{ url?: string; error?: string }>();

  const taken = new Set(connections.map((connection) => connection.name));
  const proposed = name.trim() || defaultName;
  const duplicate = taken.has(proposed);

  // The consent screen opens from the URL the connect loader builds, so the signed
  // `state` never has to round-trip through the browser's own code.
  useEffect(() => {
    if (connect.state !== "idle" || connect.data === undefined) return;
    if (connect.data.error) {
      toast.error(connect.data.error);
      return;
    }
    if (connect.data.url) {
      window.open(connect.data.url, "_blank", "width=600,height=800");
    }
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
              <ConnectionItem key={connection.id} connection={connection} />
            ))}
          </VStack>
        )}

        <HStack spacing={2} className="w-full">
          <Input
            size="sm"
            className="max-w-64"
            value={name}
            placeholder={defaultName}
            aria-label={t`Connection name`}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            size="sm"
            leftIcon={<LuPlug />}
            isDisabled={duplicate}
            isLoading={connect.state !== "idle"}
            onClick={() =>
              connect.load(
                `${path.to.api.integrationConnect(
                  pieceName
                )}?name=${encodeURIComponent(proposed)}`
              )
            }
          >
            <Trans>Add account</Trans>
          </Button>
          {duplicate && (
            <span className="text-sm text-destructive">
              <Trans>That name is already used.</Trans>
            </span>
          )}
        </HStack>
      </VStack>
    </DrawerBody>
  );
}

function ConnectionItem({ connection }: { connection: ConnectionRow }) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success?: boolean }>();
  const [name, setName] = useState(connection.name);

  return (
    <HStack className="w-full justify-between border rounded-md p-2">
      <VStack spacing={0}>
        <HStack spacing={2}>
          <Input
            size="sm"
            className="max-w-56"
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
          <Badge variant={STATUS_VARIANT[connection.status]}>
            {connection.status}
          </Badge>
        </HStack>
        {connection.accountLabel && (
          <span className="text-xs text-muted-foreground">
            {connection.accountLabel}
          </span>
        )}
        {connection.lastError && (
          <span className="text-xs text-destructive">
            {connection.lastError}
          </span>
        )}
      </VStack>
      <fetcher.Form method="post" action={path.to.integrationConnections}>
        <input type="hidden" name="intent" value="disconnect" />
        <input type="hidden" name="id" value={connection.id} />
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
    </HStack>
  );
}
