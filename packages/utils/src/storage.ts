export type PrivateStorageTarget = {
  physicalBucket: string;
  logicalFolder: string;
  objectPath: string;
};

type DownloadPrivateObjectResult<TData> = {
  data: TData | null;
  error: unknown | null;
};

type ListPrivateObjectResult<TItem> = {
  data: TItem[] | null;
  error: unknown | null;
};

type CreateSignedUrlResult = {
  error: unknown | null;
  signedUrl: string | null;
};

type BuildCompanyPrivateStorageTargetInput = {
  companyId: string;
  logicalFolder: string;
  fileName: string;
  entityId?: string | null;
};

export type PrivateBucketAttemptError = {
  physicalBucket: string;
  error: unknown;
};

export type DownloadCompanyPrivateObjectResult<TData> = {
  data: TData | null;
  errors: PrivateBucketAttemptError[];
  physicalBucket?: string;
};

export type ListCompanyPrivateObjectsResult<TItem> = {
  data: TItem[];
  errors: PrivateBucketAttemptError[];
};

export type CreateCompanyPrivateSignedUrlResult = {
  errors: PrivateBucketAttemptError[];
  physicalBucket?: string;
  signedUrl: string | null;
};

const normalizeStorageSegment = (value: string) =>
  value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");

export const getCompanyPrivateBucket = (companyId: string) => {
  return normalizeStorageSegment(companyId);
};

export const hasCompanyPrivateObjectPathPrefix = (
  companyId: string,
  objectPath: string
) => {
  return objectPath.startsWith(`${getCompanyPrivateBucket(companyId)}/`);
};

export const downloadCompanyPrivateObject = async <TData>({
  companyId,
  objectPath,
  requestedBucket,
  downloadObject
}: {
  companyId: string;
  objectPath: string;
  requestedBucket?: string;
  downloadObject: (
    physicalBucket: string,
    objectPath: string
  ) => Promise<DownloadPrivateObjectResult<TData>>;
}): Promise<DownloadCompanyPrivateObjectResult<TData>> => {
  const physicalBucket = getCompanyPrivateBucket(companyId);
  const result = await downloadObject(physicalBucket, objectPath);

  if (!result.error && result.data) {
    return {
      data: result.data,
      errors: [],
      physicalBucket
    };
  }

  return {
    data: null,
    errors: [{ physicalBucket, error: result.error }]
  };
};

export const listCompanyPrivateObjects = async <TItem>({
  companyId,
  objectPathPrefix,
  requestedBucket,
  listObjects,
  getItemKey
}: {
  companyId: string;
  objectPathPrefix: string;
  requestedBucket?: string;
  listObjects: (
    physicalBucket: string,
    objectPathPrefix: string
  ) => Promise<ListPrivateObjectResult<TItem>>;
  getItemKey: (item: TItem) => string;
}): Promise<ListCompanyPrivateObjectsResult<TItem>> => {
  const physicalBucket = getCompanyPrivateBucket(companyId);
  const result = await listObjects(physicalBucket, objectPathPrefix);

  if (result.error) {
    return {
      data: [],
      errors: [{ physicalBucket, error: result.error }]
    };
  }

  if (!result.data) {
    return { data: [], errors: [] };
  }

  // Deduplicate items just in case
  const items = new Map<string, TItem>();
  for (const item of result.data) {
    const itemKey = getItemKey(item);
    if (!items.has(itemKey)) {
      items.set(itemKey, item);
    }
  }

  return {
    data: [...items.values()],
    errors: []
  };
};

export const createCompanyPrivateSignedUrl = async ({
  companyId,
  objectPath,
  requestedBucket,
  expiresIn,
  createSignedUrl
}: {
  companyId: string;
  objectPath: string;
  requestedBucket?: string;
  expiresIn: number;
  createSignedUrl: (
    physicalBucket: string,
    objectPath: string,
    expiresIn: number
  ) => Promise<CreateSignedUrlResult>;
}): Promise<CreateCompanyPrivateSignedUrlResult> => {
  const physicalBucket = getCompanyPrivateBucket(companyId);
  const result = await createSignedUrl(physicalBucket, objectPath, expiresIn);

  if (!result.error && result.signedUrl) {
    return {
      errors: [],
      physicalBucket,
      signedUrl: result.signedUrl
    };
  }

  return {
    errors: [{ physicalBucket, error: result.error }],
    signedUrl: null
  };
};

export const buildCompanyPrivateStorageTarget = ({
  companyId,
  logicalFolder,
  fileName,
  entityId
}: BuildCompanyPrivateStorageTargetInput): PrivateStorageTarget => {
  const physicalBucket = getCompanyPrivateBucket(companyId);
  const normalizedLogicalFolder = normalizeStorageSegment(logicalFolder);
  const normalizedEntityId = entityId
    ? normalizeStorageSegment(entityId)
    : undefined;
  const normalizedFileName = normalizeStorageSegment(fileName);

  const objectPath = [
    physicalBucket,
    normalizedLogicalFolder,
    normalizedEntityId,
    normalizedFileName
  ]
    .filter(Boolean)
    .join("/");

  return {
    physicalBucket,
    logicalFolder: normalizedLogicalFolder,
    objectPath
  };
};
