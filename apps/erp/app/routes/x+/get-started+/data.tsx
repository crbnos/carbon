import { DataMigrationView } from "@carbon/onboarding/ui";

// State, flags, and mutations come from <HubProvider> in the layout — the view
// reads them via hub hooks, so the route is just the mount point.
export default function GetStartedDataRoute() {
  return <DataMigrationView />;
}
