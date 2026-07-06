import { View } from "@react-pdf/renderer";
import type { TermsBlock as TermsBlockType } from "../../../template";
import { Note } from "../../components";
import { hasContent, resolveTerms } from "../resolveTerms";
import { useTw } from "../tw";
import type { PackingSlipData } from "./types";

export function TermsBlock({
  block,
  data
}: {
  block: TermsBlockType;
  data: PackingSlipData;
}) {
  const tw = useTw();
  const terms = resolveTerms(block, data.terms, data.vars);
  if (!hasContent(terms)) return null;

  return (
    <View style={tw("w-full")}>
      <Note title="Standard Terms & Conditions" content={terms!} />
    </View>
  );
}
