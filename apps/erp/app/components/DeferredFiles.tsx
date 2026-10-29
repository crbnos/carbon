// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRevalidator } from "@carbon/query";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  HStack,
  Skeleton
} from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import { Suspense } from "react";
import { LuRefreshCw, LuTriangleAlert } from "react-icons/lu";
import { Await } from "react-router";

function DocumentsSkeleton() {
  return (
    <Card className="flex-grow">
      <HStack className="justify-between items-start">
        <CardHeader>
          <Skeleton className="h-5 w-20" />
        </CardHeader>
        <div className="py-2 px-4">
          <Skeleton className="h-9 w-24" />
        </div>
      </HStack>
      <CardContent>
        <div className="flex flex-col">
          <HStack className="justify-between items-center pb-3 border-b border-border">
            <Skeleton className="h-3 w-12" />
            <HStack className="gap-8">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-3 w-14" />
              <div className="w-8" />
            </HStack>
          </HStack>
          {Array.from({ length: 3 }).map((_, i) => (
            <HStack
              key={i}
              className="justify-between items-center py-3 border-b border-border last:border-b-0"
            >
              <HStack className="gap-3 flex-1 min-w-0">
                <Skeleton className="size-6 shrink-0 rounded" />
                <Skeleton className="h-4 w-1/3" />
              </HStack>
              <HStack className="gap-8">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="size-8 shrink-0" />
              </HStack>
            </HStack>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function FilesErrorFallback() {
  const { revalidate, state } = useRevalidator();
  return (
    <Card className="flex-grow">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <LuTriangleAlert className="size-5" />
        </div>
        <div className="flex flex-col gap-1 max-w-xs">
          <p className="text-sm font-medium">
            <Trans>Couldn't load documents</Trans>
          </p>
          <p className="text-xs text-muted-foreground">
            <Trans>
              The storage service didn't respond in time. Please try again.
            </Trans>
          </p>
        </div>
        <Button
          variant="secondary"
          leftIcon={<LuRefreshCw />}
          onClick={() => revalidate()}
          isLoading={state === "loading"}
        >
          <Trans>Retry</Trans>
        </Button>
      </CardContent>
    </Card>
  );
}

type DeferredFilesProps<Resolve> = {
  resolve: Resolve;
  children: (value: Awaited<Resolve>) => React.ReactNode;
  fallback?: React.ReactNode;
};

export function DeferredFiles<Resolve>({
  resolve,
  children,
  fallback
}: DeferredFilesProps<Resolve>) {
  return (
    <Suspense fallback={fallback ?? <DocumentsSkeleton />}>
      <Await resolve={resolve} errorElement={<FilesErrorFallback />}>
        {children}
      </Await>
    </Suspense>
  );
}

export default DeferredFiles;
