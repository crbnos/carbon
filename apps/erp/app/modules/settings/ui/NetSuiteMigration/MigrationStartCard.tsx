import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  HStack,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  VStack
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { path } from "~/utils/path";

/**
 * The one click.
 *
 * Two buttons, not one: **Preview** runs the identical code path and rolls the
 * write back, so somebody can see exactly what a migration would do to their
 * company before it does it. Preview is the primary action deliberately —
 * migrating first and reading the report afterwards is the same information in
 * the wrong order.
 */
export function MigrationStartCard({
  connected,
  disabled,
  subsidiaryChoices,
  onStart
}: {
  connected: boolean;
  disabled: boolean;
  /** Offered when the account is OneWorld and the job asked for a choice. */
  subsidiaryChoices:
    | { id: string; name: string; currencyCode: string | null }[]
    | null;
  /** Fired on click so the page can show the run before the job writes its
   *  marker. Called with null if the action refused, so the row doesn't spin forever. */
  onStart: (started: boolean) => void;
}) {
  const fetcher = useFetcher<{ success: boolean }>();
  const [subsidiaryId, setSubsidiaryId] = useState<string>("");

  const refused = fetcher.state === "idle" && fetcher.data?.success === false;
  useEffect(() => {
    if (refused) onStart(false);
  }, [refused, onStart]);

  const start = (dryRun: boolean) => {
    onStart(true);
    fetcher.submit(
      {
        intent: dryRun ? "preview" : "migrate",
        subsidiaryId: subsidiaryId || ""
      },
      { method: "post", action: path.to.netsuiteMigration }
    );
  };

  if (!connected) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <Trans>Connect NetSuite first</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Carbon needs read access to your NetSuite account. Connecting
              takes a few minutes in NetSuite and nothing in your NetSuite
              account is ever changed.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <Link to={path.to.integration("netsuite")}>
              <Trans>Connect NetSuite</Trans>
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          <Trans>Bring your NetSuite data into Carbon</Trans>
        </CardTitle>
        <CardDescription>
          <Trans>
            Your chart of accounts, customers, suppliers, items, bills of
            material, on-hand stock and open orders. Carbon only reads from
            NetSuite — nothing there changes — and everything it writes here can
            be undone in one click.
          </Trans>
        </CardDescription>
      </CardHeader>

      {subsidiaryChoices && subsidiaryChoices.length > 0 && (
        <CardContent>
          <VStack spacing={1} className="w-full max-w-sm">
            <span className="text-sm font-medium">
              <Trans>Which subsidiary?</Trans>
            </span>
            <p className="text-xs text-muted-foreground">
              <Trans>
                This NetSuite account has several. One Carbon company holds one
                subsidiary — migrating them together would double-count
                intercompany revenue and stock.
              </Trans>
            </p>
            <Select value={subsidiaryId} onValueChange={setSubsidiaryId}>
              <SelectTrigger id="subsidiaryId">
                <SelectValue placeholder="Select a subsidiary" />
              </SelectTrigger>
              <SelectContent>
                {subsidiaryChoices.map((subsidiary) => (
                  <SelectItem key={subsidiary.id} value={subsidiary.id}>
                    {subsidiary.currencyCode
                      ? `${subsidiary.name} (${subsidiary.currencyCode})`
                      : subsidiary.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </VStack>
        </CardContent>
      )}

      <CardFooter>
        <HStack spacing={2}>
          <Button
            isDisabled={disabled}
            isLoading={fetcher.state !== "idle"}
            onClick={() => start(true)}
          >
            <Trans>Preview the migration</Trans>
          </Button>
          <Button
            variant="secondary"
            isDisabled={disabled}
            onClick={() => start(false)}
          >
            <Trans>Migrate now</Trans>
          </Button>
        </HStack>
      </CardFooter>
    </Card>
  );
}
