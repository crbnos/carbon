import {
  Copy,
  Heading,
  Input,
  InputGroup,
  InputLeftAddon,
  toast,
  TooltipProvider,
} from "@carbon/react";
import { useFetcher } from "@remix-run/react";
import { json } from "@vercel/remix";
import { useEffect, useState } from "react";

import { ModelUpload } from "~/components/ModelUpload";

import type { ActionFunctionArgs } from "@vercel/remix";
import { carbon } from "~/lib/carbon.server";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    console.warn("No valid file provided in request");
    return json({ error: "No file provided", data: null }, { status: 400 });
  }

  const upload = await carbon.uploadModel(file);

  if (upload.error) {
    return json({ error: upload.error.message, data: null }, { status: 500 });
  }

  return json(upload);
}

export default function Route() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const fetcher = useFetcher<typeof action>();

  useEffect(() => {
    if (fetcher.data?.error) {
      toast.error(fetcher.data.error);
      setFile(null);
      setUrl(null);
    }
    if (fetcher.data?.data) {
      setFile(null);
      setUrl(fetcher.data.data.url);
    }
  }, [fetcher.data]);

  const onFileChange = async (file: File | null) => {
    setFile(file);

    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col items-center justify-center p-4">
        <div className="max-w-xl text-center flex flex-col gap-8">
          <Heading size="h1">Upload a 3D Model</Heading>
          {url && (
            <InputGroup>
              <Input value={url} />
              <InputLeftAddon className="border-none">
                <Copy text={url} />
              </InputLeftAddon>
            </InputGroup>
          )}
          <ModelUpload file={file} onFileChange={onFileChange} />
        </div>
      </div>
    </TooltipProvider>
  );
}
