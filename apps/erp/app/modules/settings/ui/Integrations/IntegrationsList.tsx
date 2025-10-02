import type { IntegrationConfig } from "@carbon/ee";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@carbon/react";
import { useUrlParams } from "@carbon/remix";
import { Link, useFetcher, useNavigate } from "@remix-run/react";
import { SearchFilter } from "~/components";
import { path } from "~/utils/path";

type IntegrationsListProps = {
  availableIntegrations: IntegrationConfig[];
  installedIntegrations: string[];
};

const IntegrationsList = ({
  installedIntegrations,
  availableIntegrations,
}: IntegrationsListProps) => {
  const [params] = useUrlParams();
  const search = params.get("search") || "";
  if (search) {
    availableIntegrations = availableIntegrations.filter((integration) =>
      integration.name.toLowerCase().includes(search.toLowerCase())
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row gap-4 pt-4 px-4">
        <div>
          <SearchFilter param="search" size="sm" placeholder="Search" />
        </div>
      </div>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 pb-4 px-4 w-full">
        {availableIntegrations.map((integration) => {
          return (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              installed={installedIntegrations.includes(integration.id)}
            />
          );
        })}
      </div>
    </div>
  );
};

function IntegrationCard({
  integration,
  installed,
}: {
  integration: IntegrationConfig;
  installed: boolean;
}) {
  const fetcher = useFetcher<{}>();
  const navigate = useNavigate();

  const handleInstall = async () => {
    if (integration.settings.some((setting) => setting.required)) {
      navigate(path.to.integration(integration.id));
    } else if (integration.onInitialize) {
      await integration.onInitialize?.();
    } else {
      const formData = new FormData();
      fetcher.submit(formData, {
        method: "post",
        action: path.to.integration(integration.id),
      });
    }
  };

  const handleUninstall = async () => {
    await integration?.onUninstall?.();
  };

  return (
    <Card>
      <div className="pt-6 px-6 h-16 flex items-center justify-between gap-6">
        <integration.logo className="h-10 w-auto" />
        {integration.active ? (
          installed ? (
            <Badge variant="green" className="flex-shrink-0">
              Installed
            </Badge>
          ) : null
        ) : (
          <Badge variant="secondary" className="flex-shrink-0">
            Coming soon
          </Badge>
        )}
      </div>
      <CardHeader className="pb-0">
        <div className="flex items-center space-x-2 pb-4">
          <CardTitle className="text-md font-medium leading-none p-0 m-0">
            {integration.name}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground pb-4">
        {integration.description}
      </CardContent>
      <CardFooter className="flex flex-end flex-row-reverse gap-2">
        <Button isDisabled={!installed} variant="secondary" asChild>
          <Link to={integration.active && installed ? integration.id : "#"}>
            Details
          </Link>
        </Button>
        {installed ? (
          <fetcher.Form
            method="post"
            action={path.to.integrationDeactivate(integration.id)}
            onSubmit={handleUninstall}
          >
            <Button
              variant="destructive"
              type="submit"
              isDisabled={fetcher.state !== "idle"}
              isLoading={fetcher.state !== "idle"}
            >
              Uninstall
            </Button>
          </fetcher.Form>
        ) : (
          <Button
            isDisabled={!integration.active || fetcher.state !== "idle"}
            isLoading={fetcher.state !== "idle"}
            onClick={handleInstall}
          >
            Install
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export default IntegrationsList;
