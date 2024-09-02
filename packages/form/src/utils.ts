import get from "lodash.get";

export const getPath = (object: any, path: string) => {
  return get(object, path);
};

export function setPath<T>(object: T, path: string, defaultValue: any) {
  return _setPathNormalized(object, stringToPathArray(path), defaultValue);
}

function _setPathNormalized(
  object: any,
  path: (string | number)[],
  value: any
): any {
  const leadingSegments = path.slice(0, -1);
  const lastSegment = path[path.length - 1];

  let obj = object;
  for (let i = 0; i < leadingSegments.length; i++) {
    const segment = leadingSegments[i];
    if (obj[segment] === undefined) {
      const nextSegment = leadingSegments[i + 1] ?? lastSegment;
      obj[segment] = typeof nextSegment === "number" ? [] : {};
    }
    obj = obj[segment];
  }
  obj[lastSegment] = value;
  return object;
}

export const stringToPathArray = <T extends string>(
  path: T
): (string | number)[] => {
  if (path.length === 0) return [];

  const match =
    path.match(/^\[(.+?)\](.*)$/) || path.match(/^\.?([^.[\]]+)(.*)$/);
  if (match) {
    const [, key, rest] = match;
    return [/^\d+$/.test(key) ? Number(key) : key, ...stringToPathArray(rest)];
  }
  return [path];
};
