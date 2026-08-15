import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { Link } from "react-router";
import { path } from "~/utils/path";

export function ExperiencePlaceholder({
  title,
  description,
  nextPhase
}: {
  title: string;
  description: string;
  nextPhase: string;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl items-start p-6 sm:p-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted/60 p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Not yet available in P1
            </p>
            <p className="mt-1">
              This shell slot is reserved for {nextPhase}. No operational data,
              decisions, or actions are being inferred here.
            </p>
          </div>
          <Link
            to={path.to.authenticatedRoot}
            className="mt-6 inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Return to Overview
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
