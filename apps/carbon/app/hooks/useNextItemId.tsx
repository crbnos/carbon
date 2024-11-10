import { useCarbon } from "@carbon/auth";
import { useState } from "react";
import { useUser } from "./useUser";

export function useNextItemId(
  table: "Part" | "Service" | "Tool" | "Material" | "Consumable" | "Fixture"
) {
  const { company } = useUser();
  const { carbon } = useCarbon();
  const [loading, setLoading] = useState<boolean>(false);
  const [id, setId] = useState<string>("");

  const onIdChange = async (newItemId: string) => {
    if (newItemId.endsWith("...") && carbon) {
      setLoading(true);

      const prefix = newItemId.slice(0, -3);
      try {
        const { data } = await carbon
          ?.from("item")
          .select("readableId")
          .eq("companyId", company.id)
          .eq("type", table)
          .ilike("readableId", `${prefix}%`)
          .order("readableId", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data?.readableId) {
          const sequence = data.readableId.slice(prefix.length);
          const currentSequence = parseInt(sequence);
          const nextSequence = currentSequence + 1;
          const nextId = `${prefix}${nextSequence
            .toString()
            .padStart(
              sequence.length -
                (data.readableId.split(`${currentSequence}`)?.[1].length ?? 0),
              "0"
            )}`;
          setId(nextId);
        } else {
          setId(`${prefix}${(1).toString().padStart(9, "0")}`);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    } else {
      setId(newItemId);
    }
  };

  return { id, onIdChange, loading };
}
