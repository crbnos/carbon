import {
  Copy,
  Heading,
  Input,
  InputGroup,
  InputLeftAddon,
  TooltipProvider,
  toast
} from "@carbon/react";
import { useEffect, useState } from "react";
import type { ActionFunctionArgs } from "react-router";
import { data, useFetcher } from "react-router";
import { ModelUpload } from "~/components/ModelUpload";
import { carbon } from "~/lib/carbon.server";

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    console.warn("No valid file provided in request");
    return data({ error: "No file provided", data: null }, { status: 400 });
  }

  const upload = await carbon.uploadModel(file);

  if (upload.error) {
    return data({ error: upload.error.message, data: null }, { status: 500 });
  }

  return upload;
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
      toast.success("Model uploaded successfully");
    }
  }, [fetcher.data]);

  const onFileChange = async (file: File | null) => {
    setFile(file);

    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data"
    });
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col items-center justify-center p-4">
        <div className="max-w-xl text-center flex flex-col gap-8">
          <Heading size="h1">Upload a Public 3D Model</Heading>
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
