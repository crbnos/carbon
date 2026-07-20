import { Button } from "@carbon/react";
import { useEffect } from "react";
import { LuBox, LuExternalLink, LuListChecks } from "react-icons/lu";
import { Link, useFetcher, useRevalidator } from "react-router";
import { useFlags } from "~/hooks";
import { path } from "~/utils/path";

type ItemInstruction = {
  id: string;
  status: "Draft" | "Published" | "Archived" | string;
  name: string | null;
};

/**
 * Discoverability bridge from a BOP Assembly operation to the 3D assembly
 * instructions: shows where the steps can come from without the user having to
 * know the Assemblies module exists. Published instruction → one-click sync of
 * its steps into THIS operation (via the assembly sync route); Draft/Archived →
 * open it to finish/publish; none → create one from the item's CAD model
 * (assemblies/new pre-filled with the item). Gated to the same internal flag as
 * the Assemblies module itself.
 */
export function AssemblyStepsSource({
  itemId,
  targetKind,
  operationId,
  isDisabled
}: {
  itemId: string;
  targetKind: "method" | "job";
  operationId: string;
  isDisabled: boolean;
}) {
  const { isInternal } = useFlags();
  const instructionFetcher = useFetcher<{
    instruction: ItemInstruction | null;
  }>();
  const syncFetcher = useFetcher<{ success: boolean }>();
  const revalidator = useRevalidator();

  // biome-ignore lint/correctness/useExhaustiveDependencies: load once per item
  useEffect(() => {
    if (isInternal && itemId) {
      instructionFetcher.load(path.to.api.assemblyForItem(itemId));
    }
  }, [isInternal, itemId]);

  // A successful sync wrote new steps — refresh the editor so they appear.
  useEffect(() => {
    if (syncFetcher.state === "idle" && syncFetcher.data?.success) {
      revalidator.revalidate();
    }
  }, [syncFetcher.state, syncFetcher.data, revalidator]);

  if (!isInternal) return null;
  const instruction = instructionFetcher.data?.instruction;
  if (instructionFetcher.state !== "idle" && !instructionFetcher.data) {
    return null;
  }

  const onSync = () => {
    if (!instruction) return;
    const formData = new FormData();
    formData.append("targetKind", targetKind);
    formData.append("operationId", operationId);
    syncFetcher.submit(formData, {
      method: "post",
      action: path.to.assemblySyncBop(instruction.id)
    });
  };

  return (
    <div className="mb-4 flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <LuBox className="size-4 shrink-0 text-muted-foreground" />
        <p className="truncate text-xs text-muted-foreground">
          {instruction
            ? instruction.status === "Published"
              ? `Steps can be generated from the published 3D assembly instruction${instruction.name ? ` "${instruction.name}"` : ""}.`
              : `A 3D assembly instruction${instruction.name ? ` "${instruction.name}"` : ""} exists in ${instruction.status} — publish it to sync its steps here.`
            : "Steps can be auto-generated from the item's 3D model via an assembly instruction."}
        </p>
      </div>
      {instruction ? (
        instruction.status === "Published" ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to={path.to.assemblyInstruction(instruction.id)}>
                <LuExternalLink className="mr-1 size-3.5" />
                Open
              </Link>
            </Button>
            <Button
              size="sm"
              leftIcon={<LuListChecks />}
              isDisabled={isDisabled || syncFetcher.state !== "idle"}
              isLoading={syncFetcher.state !== "idle"}
              onClick={onSync}
            >
              Sync steps from assembly
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" asChild className="shrink-0">
            <Link to={path.to.assemblyInstruction(instruction.id)}>
              <LuExternalLink className="mr-1 size-3.5" />
              Open assembly instruction
            </Link>
          </Button>
        )
      ) : (
        <Button variant="secondary" size="sm" asChild className="shrink-0">
          <Link to={`${path.to.newAssemblyInstruction}?itemId=${itemId}`}>
            <LuBox className="mr-1 size-3.5" />
            Create assembly instruction
          </Link>
        </Button>
      )}
    </div>
  );
}
