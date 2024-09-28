import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
} from "@carbon/react";
import { useNavigate } from "@remix-run/react";
import type { Integration } from "../../types";

type IntegrationsListProps = {
  integrations: Integration[];
};

const IntegrationsList = ({ integrations }: IntegrationsListProps) => {
  const navigate = useNavigate();
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 p-4 w-full">
      {integrations.map((integration) => {
        return (
          <Card
            key={integration.id}
            className="cursor-pointer"
            onClick={() => navigate(integration.id!)}
          >
            <CardHeader>
              <CardTitle className="text-sm md:text-base">
                {integration.title}
              </CardTitle>
              <CardDescription>{integration.description}</CardDescription>
            </CardHeader>

            <CardContent>
              <Switch checked={!!integration.active} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default IntegrationsList;
