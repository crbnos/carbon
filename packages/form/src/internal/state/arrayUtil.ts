import invariant from "tiny-invariant";
import { getPath, setPath } from "../../utils";

////
// All of these array helpers are written in a way that mutates the original array.
// This is because we're working with immer.
////

export const getArray = (values: any, field: string): unknown[] => {
  const value = getPath(values, field);
  if (value === undefined || value === null) {
    const newValue: unknown[] = [];
    setPath(values, field, newValue);
    return newValue;
  }
  invariant(
    Array.isArray(value),
    `FieldArray: defaultValue value for ${field} must be an array, null, or undefined`
  );
  return value;
};

export const sparseCopy = <T>(array: T[]): T[] => array.slice();

export const swap = (array: unknown[], indexA: number, indexB: number) => {
  const itemA = array[indexA];
  const itemB = array[indexB];

  const hasItemA = indexA in array;
  const hasItemB = indexB in array;

  // If we're dealing with a sparse array (i.e. one of the indeces doesn't exist),
  // we should keep it sparse
  if (hasItemA) {
    array[indexB] = itemA;
  } else {
    delete array[indexB];
  }

  if (hasItemB) {
    array[indexA] = itemB;
  } else {
    delete array[indexA];
  }
};

// A splice that can handle sparse arrays
function sparseSplice(
  array: unknown[],
  start: number,
  deleteCount?: number,
  item?: unknown
) {
  // Inserting an item into an array won't behave as we need it to if the array isn't
  // at least as long as the start index. We can force the array to be long enough like this.
  if (array.length < start && item) {
    array.length = start;
  }

  // If we just pass item in, it'll be undefined and splice will delete the item.
  if (arguments.length === 4) return array.splice(start, deleteCount!, item);
  else if (arguments.length === 3) return array.splice(start, deleteCount);
  return array.splice(start);
}

export const move = (array: unknown[], from: number, to: number) => {
  const [item] = sparseSplice(array, from, 1);
  sparseSplice(array, to, 0, item);
};

export const insert = (array: unknown[], index: number, value: unknown) => {
  sparseSplice(array, index, 0, value);
};

export const insertEmpty = (array: unknown[], index: number) => {
  const tail = sparseSplice(array, index);
  tail.forEach((item, i) => {
    sparseSplice(array, index + i + 1, 0, item);
  });
};

export const remove = (array: unknown[], index: number) => {
  sparseSplice(array, index, 1);
};

export const replace = (array: unknown[], index: number, value: unknown) => {
  sparseSplice(array, index, 1, value);
};

/**
 * The purpose of this helper is to make it easier to update `fieldErrors` and `touchedFields`.
 * We key those objects by full paths to the fields.
 * When we're doing array mutations, that makes it difficult to update those objects.
 */
export const mutateAsArray = (
  field: string,
  obj: Record<string, any>,
  mutate: (arr: any[]) => void
) => {
  const beforeKeys = new Set<string>();
  const arr: any[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith(field) && key !== field) {
      beforeKeys.add(key);
      setPath(arr, key.substring(field.length), value);
    }
  }

  mutate(arr);
  for (const key of beforeKeys) {
    delete obj[key];
  }

  const newKeys = getDeepArrayPaths(arr);
  for (const key of newKeys) {
    const val = getPath(arr, key);
    if (val !== undefined) {
      obj[`${field}${key}`] = val;
    }
  }
};

const getDeepArrayPaths = (obj: any, basePath: string = ""): string[] => {
  // This only needs to handle arrays and plain objects
  // and we can assume the first call is always an array.

  if (Array.isArray(obj)) {
    return obj.flatMap((item, index) =>
      getDeepArrayPaths(item, `${basePath}[${index}]`)
    );
  }

  if (typeof obj === "object") {
    return Object.keys(obj).flatMap((key) =>
      getDeepArrayPaths(obj[key], `${basePath}.${key}`)
    );
  }

  return [basePath];
};
