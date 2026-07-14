import type { Json } from "@carbon/database";
import { Badge, Button, ClientOnly, cn, Spinner } from "@carbon/react";
import type {
  AssemblyStep,
  CameraPose,
  Fastener,
  Motion
} from "@carbon/viewer";
import { AssemblyPlayer } from "@carbon/viewer";
import { Trans } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import {
  LuChevronLeft,
  LuChevronRight,
  LuFileVideo,
  LuInfo,
  LuOctagonAlert,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import { getPrivateUrl } from "~/utils/path";

export type AssemblyInstructionData = {
  name: string | null;
  glbPath: string;
  graphPath: string;
  steps: {
    id: string;
    title: string | null;
    instructionText: string | null;
    componentNodeIds: string[];
    motion: Json;
    camera: Json | null;
    fastener: Json | null;
    durationSeconds: number | null;
    warnings: Json | null;
  }[];
  requirements: {
    id: string;
    stepId: string;
    type: "Tool" | "Fixture" | "Consumable" | "Note" | "Media";
    name: string | null;
    text: string | null;
    severity: "Info" | "Caution" | "Warning" | null;
    filePath: string | null;
    quantity: number;
  }[];
};

type StepRequirement = AssemblyInstructionData["requirements"][number];

const motionTypes = ["linear", "L", "helix", "path", "none"];

function toViewerStep(
  step: AssemblyInstructionData["steps"][number]
): AssemblyStep {
  const motion = step.motion as Motion | null;
  // Planner flag: no collision-free path — the player fades the components in
  const warnings = step.warnings as { flagged?: boolean } | null;
  return {
    id: step.id,
    title: step.title,
    instructionText: step.instructionText,
    componentNodeIds: step.componentNodeIds ?? [],
    motion:
      motion && typeof motion === "object" && motionTypes.includes(motion.type)
        ? motion
        : { type: "none" },
    camera: (step.camera as CameraPose | null) ?? null,
    fastener: (step.fastener as Fastener | null) ?? null,
    durationSeconds: step.durationSeconds,
    flagged: warnings?.flagged === true ? true : undefined
  };
}

type AssemblyInstructionsProps = {
  assembly: AssemblyInstructionData;
  mode: "light" | "dark";
};

export function AssemblyInstructions({
  assembly,
  mode
}: AssemblyInstructionsProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const steps = useMemo(
    () => assembly.steps.map(toViewerStep),
    [assembly.steps]
  );

  const stepCount = steps.length;
  const activeStepId = assembly.steps[activeStepIndex]?.id;
  const activeRequirements = useMemo(
    () =>
      (assembly.requirements ?? []).filter(
        (requirement) => requirement.stepId === activeStepId
      ),
    [assembly.requirements, activeStepId]
  );

  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">
        <ClientOnly
          fallback={
            <div className="flex h-full w-full items-center justify-center">
              <Spinner className="h-10 w-10" />
            </div>
          }
        >
          {() => (
            <AssemblyPlayer
              glbUrl={getPrivateUrl(assembly.glbPath)}
              graphUrl={getPrivateUrl(assembly.graphPath)}
              steps={steps}
              activeStepIndex={activeStepIndex}
              onStepChange={setActiveStepIndex}
              readOnly
              mode={mode}
              className="h-full"
            />
          )}
        </ClientOnly>
      </div>
      {activeRequirements.length > 0 && (
        <StepRequirements requirements={activeRequirements} />
      )}
      <div className="grid grid-cols-2 gap-2 border-t border-border bg-background p-3">
        <Button
          size="lg"
          variant="secondary"
          className="h-16 text-lg active:scale-[0.96] transition-transform"
          leftIcon={<LuChevronLeft className="size-6" />}
          isDisabled={activeStepIndex <= 0}
          onClick={() => setActiveStepIndex((index) => Math.max(index - 1, 0))}
        >
          <Trans>Previous</Trans>
        </Button>
        <Button
          size="lg"
          className="h-16 text-lg active:scale-[0.96] transition-transform"
          rightIcon={<LuChevronRight className="size-6" />}
          isDisabled={activeStepIndex >= stepCount - 1}
          onClick={() =>
            setActiveStepIndex((index) => Math.min(index + 1, stepCount - 1))
          }
        >
          <Trans>Next</Trans>
        </Button>
      </div>
    </div>
  );
}

const severityStyles = {
  Info: { icon: LuInfo, className: "border-blue-500/40 text-blue-600" },
  Caution: {
    icon: LuTriangleAlert,
    className: "border-yellow-500/40 text-yellow-600"
  },
  Warning: {
    icon: LuOctagonAlert,
    className: "border-red-500/40 text-red-600"
  }
} as const;

/** The active step's process data: notes, tools/fixtures/consumables, media */
function StepRequirements({
  requirements
}: {
  requirements: StepRequirement[];
}) {
  const notes = requirements.filter((r) => r.type === "Note");
  const resources = requirements.filter((r) =>
    ["Tool", "Fixture", "Consumable"].includes(r.type)
  );
  const media = requirements.filter((r) => r.type === "Media" && r.filePath);

  return (
    <div className="max-h-56 overflow-y-auto border-t border-border bg-background px-3 py-2">
      <div className="flex flex-col gap-2">
        {notes.map((note) => {
          const { icon: Icon, className } =
            severityStyles[note.severity ?? "Info"];
          return (
            <div
              key={note.id}
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                className
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="whitespace-pre-wrap text-foreground">
                {note.text}
              </span>
            </div>
          );
        })}
        {resources.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <LuWrench
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            {resources.map((resource) => (
              <Badge key={resource.id} variant="secondary">
                {resource.name}
                {resource.quantity > 1 ? ` ×${resource.quantity}` : ""}
                {resource.type !== "Tool" && (
                  <span className="ml-1 text-muted-foreground">
                    · {resource.type}
                  </span>
                )}
              </Badge>
            ))}
          </div>
        )}
        {media.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {media.map((item) => {
              const url = getPrivateUrl(item.filePath ?? "");
              const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(
                item.filePath ?? ""
              );
              return (
                <a
                  key={item.id}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                  title={item.name ?? undefined}
                >
                  {isVideo ? (
                    <span className="flex h-16 w-16 items-center justify-center rounded-md border border-border">
                      <LuFileVideo className="h-6 w-6 text-muted-foreground" />
                    </span>
                  ) : (
                    <img
                      src={url}
                      alt={item.name ?? "Attachment"}
                      className="h-16 w-16 rounded-md border border-border object-cover"
                    />
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
