import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTrash2 } from "react-icons/lu";

export type ScrappableEntity = {
  id: string;
  readableId?: string | null;
  state: "Available" | "Consumed";
};

// The material's scrappable tracked entities: available ones (picked / in
// stock, not yet consumed) and already-consumed ones. Each row scraps the
// entity via the shared ScrapEntityModal (opened by onScrap). The edge
// function branches on the entity's state — Available scraps from stock,
// Consumed relieves WIP and reopens the requirement.
export function ScrapTab({
  entities,
  onScrap
}: {
  entities: ScrappableEntity[];
  onScrap: (entity: ScrappableEntity) => void;
}) {
  const { t } = useLingui();

  if (entities.length === 0) {
    return (
      <Alert variant="warning">
        <AlertTitle>
          <Trans>Nothing to scrap</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>
            There are no available or consumed tracked parts for this material.
          </Trans>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {entities.map((entity) => (
        <div
          key={`${entity.state}-${entity.id}`}
          className="flex items-center gap-3 rounded-md border p-3"
        >
          <div className="flex-1">
            <div className="text-sm font-medium">
              {entity.readableId ?? entity.id}
            </div>
            <Badge
              variant={entity.state === "Consumed" ? "secondary" : "outline"}
            >
              {entity.state === "Consumed" ? (
                <Trans>Consumed</Trans>
              ) : (
                <Trans>Available</Trans>
              )}
            </Badge>
          </div>
          <Button
            variant="destructive"
            size="lg"
            leftIcon={<LuTrash2 />}
            onClick={() => onScrap(entity)}
          >
            {t`Scrap`}
          </Button>
        </div>
      ))}
    </div>
  );
}
