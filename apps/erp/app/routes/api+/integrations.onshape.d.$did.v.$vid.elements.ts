import { requirePermissions } from "@carbon/auth/auth.server";
import {
  getOnshapeClient,
  OnshapeDocument,
  OnshapeElementType,
  OnshapeWVMType
} from "@carbon/ee/onshape";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";

export const shouldRevalidate: ShouldRevalidateFunction = () => {
  return false;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const { did } = params;
  if (!did) {
    return {
      data: [],
      error: "Document ID is required"
    };
  }

  const { vid } = params;
  if (!vid) {
    return {
      data: [],
      error: "Version ID is required"
    };
  }

  const result = await getOnshapeClient(client, companyId, userId);

  if (result.error) {
    return {
      data: [],
      error: result.error
    };
  }

  const onshapeClient = result.client;
  const document: OnshapeDocument = {
    documentId: did,
    wvm: OnshapeWVMType.VERSION,
    wvmId: vid
  };

  try {
    const documentAssemblies = await onshapeClient.getElements(document, OnshapeElementType.ASSEMBLY);

    return {
      data: documentAssemblies,
      error: null
    };
  } catch (error) {
    console.error(error);
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get assemblies from Onshape"
    };
  }
}
