import { Combobox, Hidden, Number, Submit, ValidatedForm } from "@carbon/form";
import { Badge, HStack, IconButton, VStack } from "@carbon/react";
import { useEffect, useMemo, useState } from "react";
import { LuCirclePlus, LuTrash } from "react-icons/lu";
import { useFetcher } from "react-router";
import { Empty } from "~/components";
import { usePermissions } from "~/hooks";
import { path } from "~/utils/path";
import { assemblyStepMaterialValidator } from "../../production.models";
import type { FlattenedBomMaterial } from "../../production.service";
import type { AssemblyStepMaterial } from "../../types";

type AssemblyStepMaterialsProps = {
  stepId: string;
  instructionId: string;
  materials: AssemblyStepMaterial[];
  bomMaterials: FlattenedBomMaterial[];
  isDisabled: boolean;
};

/**
 * Bill-of-material parts consumed at this step. The picker is limited to the
 * instruction item's make-method BOM; associations are stored by itemId so
 * they survive make-method re-versioning.
 */
export default function AssemblyStepMaterials({
  stepId,
  instructionId,
  materials,
  bomMaterials,
  isDisabled
}: AssemblyStepMaterialsProps) {
  const permissions = usePermissions();
  const fetcher = useFetcher<{ success: boolean }>();
  // Remount the form after a successful add so the fields clear
  const [formKey, setFormKey] = useState(0);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setFormKey((key) => key + 1);
      setSelectedItemId(null);
    }
  }, [fetcher.state, fetcher.data]);

  // One option per distinct BOM item, excluding items already on the step
  const options = useMemo(() => {
    const usedItemIds = new Set(materials.map((material) => material.itemId));
    const seen = new Set<string>();
    return bomMaterials.reduce<{ label: string; value: string }[]>(
      (acc, material) => {
        if (seen.has(material.itemId) || usedItemIds.has(material.itemId)) {
          return acc;
        }
        seen.add(material.itemId);
        acc.push({
          label: [material.readableIdWithRevision, material.name]
            .filter(Boolean)
            .join(" — "),
          value: material.itemId
        });
        return acc;
      },
      []
    );
  }, [bomMaterials, materials]);

  const selectedBomLine = useMemo(
    () =>
      selectedItemId
        ? bomMaterials.find((material) => material.itemId === selectedItemId)
        : undefined,
    [bomMaterials, selectedItemId]
  );

  return (
    <VStack spacing={2} className="w-full">
      <h4 className="text-xxs text-foreground/70 uppercase font-light tracking-wide">
        Materials
      </h4>
      {materials.length === 0 ? (
        <p className="text-xs text-muted-foreground">No materials to display</p>
      ) : (
        <ul className="w-full">
          {materials.map((material) => (
            <MaterialRow
              key={material.id}
              material={material}
              instructionId={instructionId}
              isDisabled={isDisabled}
            />
          ))}
        </ul>
      )}
      {!isDisabled &&
        (bomMaterials.length === 0 ? (
          <Empty className="border-none">
            <p className="text-sm text-muted-foreground max-w-[300px] text-center">
              Link this instruction to an item with a make method to pick BOM
              parts
            </p>
          </Empty>
        ) : (
          permissions.can("create", "production") && (
            <ValidatedForm
              key={formKey}
              validator={assemblyStepMaterialValidator}
              method="post"
              action={path.to.newAssemblyStepMaterial(instructionId)}
              fetcher={fetcher}
              className="w-full"
            >
              <Hidden name="stepId" value={stepId} />
              <VStack spacing={2} className="w-full">
                <Combobox
                  name="itemId"
                  placeholder="Pick a BOM item"
                  options={options}
                  onChange={(option) =>
                    setSelectedItemId(option?.value ?? null)
                  }
                />
                {/* The hint sits under the whole row so the Add button
                    bottom-aligns with the quantity input itself */}
                <VStack spacing={1} className="w-full">
                  <HStack className="w-full items-end" spacing={2}>
                    <div className="flex-1 min-w-0">
                      <Number name="quantity" label="Quantity" minValue={0} />
                    </div>
                    <Submit
                      variant="secondary"
                      leftIcon={<LuCirclePlus />}
                      isDisabled={fetcher.state !== "idle"}
                    >
                      Add
                    </Submit>
                  </HStack>
                  <p className="font-normal text-xs text-muted-foreground">
                    {selectedBomLine
                      ? `${selectedBomLine.quantity} on the BOM — leave blank for as needed`
                      : "Leave blank for as needed"}
                  </p>
                </VStack>
              </VStack>
            </ValidatedForm>
          )
        ))}
    </VStack>
  );
}

function MaterialRow({
  material,
  instructionId,
  isDisabled
}: {
  material: AssemblyStepMaterial;
  instructionId: string;
  isDisabled: boolean;
}) {
  const deleteFetcher = useFetcher<{ success: boolean }>();
  const permissions = usePermissions();

  // Optimistically remove the row while the delete is in flight
  if (deleteFetcher.state !== "idle") return null;

  return (
    <li className="flex w-full items-center gap-2 border-b border-border py-1.5 text-sm">
      <span
        className="min-w-0 flex-1 truncate"
        title={material.item?.name ?? undefined}
      >
        {material.item?.name}
      </span>
      {material.item?.readableIdWithRevision && (
        <span className="text-xs text-muted-foreground">
          {material.item.readableIdWithRevision}
        </span>
      )}
      <Badge variant="secondary" className="tabular-nums">
        {material.quantity != null ? `×${material.quantity}` : "as needed"}
      </Badge>
      {!isDisabled && permissions.can("delete", "production") && (
        <IconButton
          aria-label={`Delete ${material.item?.name ?? "material"}`}
          icon={<LuTrash />}
          variant="ghost"
          size="sm"
          onClick={() => {
            deleteFetcher.submit(new FormData(), {
              method: "post",
              action: path.to.deleteAssemblyStepMaterial(
                instructionId,
                material.id
              )
            });
          }}
        />
      )}
    </li>
  );
}
