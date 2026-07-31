import { cn } from "@carbon/react";
import {
  VariableText,
  type VariableTextHandle,
  type VariableTextPart,
  type VariableTextToken
} from "@carbon/react/VariableText";
import type { ItemRef, TemplatePart, VariableRef } from "@carbon/workflows";
import { useRef, useState } from "react";
import { LuVariable } from "react-icons/lu";
import type { BuilderNode } from "../../../types";
import { useBuilderStore } from "../context";
import type { ValueFieldProps } from "./types";
import { VariablePicker } from "./VariablePicker";

// ── helpers ──────────────────────────────────────────────────────────────────

function tokenLabel(ref: VariableRef | ItemRef, nodes: BuilderNode[]): string {
  if (ref.kind === "item") return "Current item";
  const node = nodes.find((n) => n.id === ref.nodeId);
  const nodeTitle = node?.title ?? node?.type ?? ref.nodeId;
  return `${nodeTitle} › ${ref.output}`;
}

function toEditorParts(
  parts: TemplatePart[],
  nodes: BuilderNode[]
): VariableTextPart[] {
  return parts.map((p): VariableTextPart => {
    if (p.kind === "text") return p;
    return {
      kind: "token",
      id: JSON.stringify(p),
      label: tokenLabel(p, nodes)
    };
  });
}

function toTemplateParts(parts: VariableTextPart[]): TemplatePart[] {
  const result: TemplatePart[] = [];
  for (const p of parts) {
    if (p.kind === "text") {
      result.push({ kind: "text", text: p.text });
    } else {
      try {
        result.push(JSON.parse(p.id) as TemplatePart);
      } catch {
        // drop malformed tokens
      }
    }
  }
  return result;
}

function isBlank(parts: VariableTextPart[]): boolean {
  return (
    parts.length === 0 || parts.every((p) => p.kind === "text" && p.text === "")
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export function TemplateField({
  label,
  type,
  required,
  value,
  onChange,
  context,
  issue
}: ValueFieldProps) {
  const handle = useRef<VariableTextHandle>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const nodes = useBuilderStore((s) => s.nodes);

  // Computed once at mount; VariableText ignores value-prop updates after mount.
  const [initialParts] = useState<VariableTextPart[]>(() =>
    value?.kind === "template" ? toEditorParts(value.parts, nodes) : []
  );

  function handleEditorChange(parts: VariableTextPart[]) {
    if (isBlank(parts)) {
      onChange(undefined);
    } else {
      onChange({ kind: "template", parts: toTemplateParts(parts) });
    }
  }

  function handlePickRef(ref: VariableRef | ItemRef) {
    const token: VariableTextToken = {
      id: JSON.stringify(ref),
      label: tokenLabel(ref, nodes)
    };
    handle.current?.insertToken(token);
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      <div
        className={cn(
          "flex items-start gap-1",
          issue && "rounded-md ring-2 ring-destructive ring-offset-1"
        )}
      >
        <div className="flex-1">
          <VariableText
            ref={handle}
            value={initialParts}
            onChange={handleEditorChange}
            placeholder="Type a message…"
            multiline={false}
          />
        </div>
        <VariablePicker
          accepts={type}
          acceptsAny
          nodeId={context.nodeId}
          inLoop={context.inLoop}
          value={undefined}
          onChange={handlePickRef}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
        >
          <button
            type="button"
            title="Insert variable"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Insert variable"
            onClick={() => setPickerOpen(true)}
          >
            <LuVariable className="h-4 w-4" />
          </button>
        </VariablePicker>
      </div>
      {issue && <p className="text-xs text-destructive">{issue}</p>}
    </div>
  );
}
