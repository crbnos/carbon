import type { JSONContent } from "@carbon/react";
import { Editor } from "@carbon/react";
import { useState } from "react";
import ProseMirror from "~/styles/prosemirror.css?url";

export function links() {
  return [{ rel: "stylesheet", href: ProseMirror }];
}

export default function WysiwygRoute() {
  const [value, setValue] = useState<JSONContent>({
    type: "doc",
    content: [{ type: "paragraph", content: [{ text: "Hello, CarbonOS!" }] }],
  });

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <Editor initialValue={value} onChange={setValue} />
    </div>
  );
}
