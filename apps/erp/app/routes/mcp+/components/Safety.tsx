import { SpecList, SpecRow } from "./SpecRow";
import { Tag } from "./Tag";

export function Safety() {
  return (
    <>
      <p className="text-muted-foreground max-w-[64ch] mb-6 text-[0.95rem] [text-wrap:pretty]">
        Every tool is classified so you always know what's safe and what mutates
        data.
      </p>
      <SpecList>
        <SpecRow label={<Tag kind="READ" />}>
          Always safe — no data changes.
        </SpecRow>
        <SpecRow label={<Tag kind="WRITE" />}>
          Creates or updates records.
        </SpecRow>
        <SpecRow label={<Tag kind="DESTRUCTIVE" />}>
          Deletes data — keep human confirmation on.
        </SpecRow>
      </SpecList>
      <p className="text-muted-foreground text-[0.9rem] mt-3 max-w-[64ch] [text-wrap:pretty]">
        A key only ever sees what its user could see in Carbon. Cross-company
        access is impossible.
      </p>
    </>
  );
}
