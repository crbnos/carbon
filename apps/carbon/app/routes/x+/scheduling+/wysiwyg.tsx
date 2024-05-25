import type { JSONContent } from "@carbon/react";
import { Editor, useDebounce } from "@carbon/react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import ProseMirror from "~/styles/prosemirror.css?url";

import type { ActionFunctionArgs } from "@remix-run/node";

export function links() {
  return [{ rel: "stylesheet", href: ProseMirror }];
}

export async function loader() {
  return {
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Work Instruction" }],
        },
        { type: "paragraph" },
        { type: "paragraph" },
      ],
    },
  };
}

export async function action({ request }: ActionFunctionArgs) {
  // get form data from request
  const formData = await request.formData();
  const content = JSON.parse(formData.get("content") as string);

  console.log({ content });
  return null;
}

export default function WysiwygRoute() {
  const { content } = useLoaderData<{ content: JSONContent }>();
  const [value, setValue] = useState<JSONContent>(content);
  const fetcher = useFetcher();

  const debounceSearch = useDebounce((c: JSONContent) => {
    const formData = new FormData();
    formData.append("content", JSON.stringify(c));

    fetcher.submit(formData, {
      method: "post",
    });
  }, 3000);

  const onChange = (c: JSONContent) => {
    setValue(c);
    debounceSearch(c);
  };

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <Editor initialValue={value} onChange={onChange} />
    </div>
  );
}
