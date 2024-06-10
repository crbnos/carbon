import { useState } from "react";
import { useSupabase } from "~/lib/supabase";
import { useUser } from "./useUser";

export function useNextItemId(
  table: "part" | "service" | "tool" | "material" | "consumable"
) {
  const { company } = useUser();
  const { supabase } = useSupabase();
  const [loading, setLoading] = useState<boolean>(false);
  const [id, setId] = useState<string>("");

  const onIdChange = async (newToolId: string) => {
    if (newToolId.endsWith("...") && supabase) {
      setLoading(true);

      const prefix = newToolId.slice(0, -3);
      try {
        const { data } = await supabase
          ?.from(table)
          .select("id")
          .eq("companyId", company.id)
          .ilike("id", `${prefix}%`)
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.id) {
          const sequence = data.id.slice(prefix.length);
          const currentSequence = parseInt(sequence);
          const nextSequence = currentSequence + 1;
          const nextId = `${prefix}${nextSequence
            .toString()
            .padStart(
              sequence.length -
                (data.id.split(`${currentSequence}`)?.[1].length ?? 0),
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
      setId(newToolId);
    }
  };

  return { id, onIdChange, loading };
}
