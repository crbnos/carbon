import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Heading,
  HStack,
  Menubar,
  useDisclosure,
  VStack
} from "@carbon/react";
import { useLingui } from "@lingui/react/macro";
import {
  LuCheck,
  LuCirclePlay,
  LuFileText,
  LuSquareCheckBig,
  LuWandSparkles,
  LuX
} from "react-icons/lu";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  Outlet,
  useFetcher,
  useLoaderData,
  useParams
} from "react-router";
import { usePermissions } from "~/hooks";
import {
  cutListValidator,
  getCutList,
  getCutListLines,
  getCutPatterns,
  isCutListEditable,
  upsertCutList
} from "~/modules/production";
import type { AvailableLot } from "~/modules/production/ui/CutLists/CutListCompleteModal";
import CutListCompleteModal from "~/modules/production/ui/CutLists/CutListCompleteModal";
import CutListLines from "~/modules/production/ui/CutLists/CutListLines";
import CutListPatterns from "~/modules/production/ui/CutLists/CutListPatterns";
import CutListStatus from "~/modules/production/ui/CutLists/CutListStatus";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const [cutList, lines, patterns] = await Promise.all([
    getCutList(client, id, companyId),
    getCutListLines(client, id, companyId),
    getCutPatterns(client, id, companyId)
  ]);

  if (cutList.error || !cutList.data) {
    throw redirectToList(request, cutList.error);
  }

  // Available batch-tracked stock for the materials on this list. Remnants
  // sort first — the point of tracking a drop is to use it before a new bar.
  const itemIds = [...new Set((lines.data ?? []).map((line) => line.itemId))];
  let lots: AvailableLot[] = [];
  if (itemIds.length > 0) {
    const entities = await client
      .from("trackedEntity")
      .select("id, readableId, itemId, quantity, attributes")
      .eq("companyId", companyId)
      .eq("status", "Available")
      .in("itemId", itemIds);

    lots = (entities.data ?? [])
      .map((entity) => {
        const attributes = (entity.attributes ?? {}) as Record<string, unknown>;
        return {
          id: entity.id,
          readableId: entity.readableId,
          itemId: entity.itemId,
          quantity: Number(entity.quantity ?? 0),
          length:
            attributes.Length !== undefined ? Number(attributes.Length) : null,
          heatNumber:
            attributes["Heat Number"] !== undefined
              ? String(attributes["Heat Number"])
              : null
        };
      })
      .sort((a, b) => {
        // Remnants before full stock; shortest remnant first.
        const aIsRemnant = a.length !== null;
        const bIsRemnant = b.length !== null;
        if (aIsRemnant !== bIsRemnant) return aIsRemnant ? -1 : 1;
        if (aIsRemnant && bIsRemnant) return (a.length ?? 0) - (b.length ?? 0);
        return (a.readableId ?? "").localeCompare(b.readableId ?? "");
      });
  }

  return {
    cutList: cutList.data,
    lines: lines.data ?? [],
    patterns: patterns.data ?? [],
    lots
  };
}

function redirectToList(request: Request, cause: unknown) {
  return new Response(null, {
    status: 302,
    headers: { Location: path.to.cutLists }
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "production"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const formData = await request.formData();
  const validation = await validator(cutListValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updated = await upsertCutList(client, {
    ...validation.data,
    id,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updated.error) {
    return data(
      {},
      await flash(request, error(updated.error, "Failed to update cut list"))
    );
  }

  return data({}, await flash(request, success("Updated cut list")));
}

export default function CutListRoute() {
  const { cutList, lines, patterns, lots } = useLoaderData<typeof loader>();
  const { id } = useParams();
  const { t } = useLingui();
  const permissions = usePermissions();
  const statusFetcher = useFetcher();
  const optimizeFetcher = useFetcher();
  const completeDisclosure = useDisclosure();

  const isEditable = isCutListEditable(cutList.status);
  const canUpdate = permissions.can("update", "production");
  const unit = cutList.unitOfDimension ?? "in";

  const setStatus = (status: string) => {
    statusFetcher.submit(
      { status },
      { method: "post", action: path.to.cutListStatus(id!) }
    );
  };

  return (
    <>
      <VStack spacing={4} className="p-4 h-full overflow-y-auto">
        <HStack className="w-full justify-between items-start">
          <VStack spacing={1}>
            <HStack>
              <Heading size="h3">{cutList.cutListId}</Heading>
              <CutListStatus status={cutList.status} />
            </HStack>
            <HStack className="text-sm text-muted-foreground gap-4">
              {cutList.processName && <span>{cutList.processName}</span>}
              {cutList.locationName && <span>{cutList.locationName}</span>}
              <span className="tabular-nums">
                {t`Kerf`} {cutList.kerf} · {t`Trim`} {cutList.endTrim} ·{" "}
                {t`Grip`} {cutList.gripMargin} · {t`Min drop`}{" "}
                {cutList.minRemnantLength} {unit}
              </span>
            </HStack>
          </VStack>

          <Menubar>
            <Button
              leftIcon={<LuFileText />}
              variant="secondary"
              asChild
              isDisabled={false}
            >
              <a
                href={path.to.cutListPdf(id!)}
                target="_blank"
                rel="noreferrer"
              >
                {t`Print`}
              </a>
            </Button>
            {isEditable && canUpdate && (
              <Button
                leftIcon={<LuWandSparkles />}
                variant="secondary"
                isLoading={optimizeFetcher.state !== "idle"}
                isDisabled={
                  optimizeFetcher.state !== "idle" || lines.length === 0
                }
                onClick={() =>
                  optimizeFetcher.submit(
                    {},
                    { method: "post", action: path.to.cutListOptimize(id!) }
                  )
                }
              >
                {t`Optimize`}
              </Button>
            )}
            {cutList.status === "Draft" && canUpdate && (
              <Button
                leftIcon={<LuCheck />}
                variant="primary"
                isDisabled={lines.length === 0}
                onClick={() => setStatus("Released")}
              >
                {t`Release`}
              </Button>
            )}
            {cutList.status === "Released" && canUpdate && (
              <Button
                leftIcon={<LuCirclePlay />}
                variant="primary"
                onClick={() => setStatus("In Progress")}
              >
                {t`Start`}
              </Button>
            )}
            {(cutList.status === "Released" ||
              cutList.status === "In Progress") &&
              canUpdate && (
                <Button
                  leftIcon={<LuSquareCheckBig />}
                  variant="primary"
                  onClick={completeDisclosure.onOpen}
                >
                  {t`Complete`}
                </Button>
              )}
            {(cutList.status === "Draft" || cutList.status === "Released") &&
              canUpdate && (
                <Button
                  leftIcon={<LuX />}
                  variant="secondary"
                  onClick={() => setStatus("Cancelled")}
                >
                  {t`Cancel`}
                </Button>
              )}
          </Menubar>
        </HStack>

        {(cutList.plannedYieldPct !== null ||
          cutList.actualYieldPct !== null) && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>{t`Yield`}</CardTitle>
            </CardHeader>
            <CardContent>
              <HStack spacing={8}>
                {cutList.plannedYieldPct !== null && (
                  <VStack spacing={0}>
                    <span className="text-2xl font-semibold tabular-nums">
                      {Number(cutList.plannedYieldPct).toFixed(1)}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t`Planned`}
                    </span>
                  </VStack>
                )}
                {cutList.actualYieldPct !== null && (
                  <VStack spacing={0}>
                    <span className="text-2xl font-semibold tabular-nums">
                      {Number(cutList.actualYieldPct).toFixed(1)}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t`Actual`}
                    </span>
                  </VStack>
                )}
                <VStack spacing={0}>
                  <span className="text-2xl font-semibold tabular-nums">
                    {cutList.totalPiecesCut ?? 0}/{cutList.totalPieces ?? 0}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t`Pieces cut`}
                  </span>
                </VStack>
              </HStack>
            </CardContent>
          </Card>
        )}

        <div className="w-full">
          <CutListLines
            cutListId={id!}
            lines={lines}
            unitOfDimension={unit}
            isEditable={isEditable}
          />
        </div>

        <div className="w-full">
          <CutListPatterns
            patterns={patterns}
            lines={lines}
            unitOfDimension={unit}
          />
        </div>
      </VStack>

      {completeDisclosure.isOpen && (
        <CutListCompleteModal
          cutListId={id!}
          lines={lines}
          lots={lots}
          unitOfDimension={unit}
          minRemnantLength={Number(cutList.minRemnantLength ?? 0)}
          onClose={completeDisclosure.onClose}
        />
      )}

      <Outlet />
    </>
  );
}
