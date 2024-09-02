/**
 * The purpose of this type is to simplify the logic
 * around data that needs to come from the server initially,
 * but from the internal state after hydration.
 */
export type Hydratable<T> = {
  hydrateTo: (data: T) => T;
  map: <U>(fn: (data: T) => U) => Hydratable<U>;
};

const serverData = <T>(data: T): Hydratable<T> => ({
  hydrateTo: () => data,
  map: (fn) => serverData(fn(data)),
});

const hydratedData = <T>(): Hydratable<T> => ({
  hydrateTo: (hydratedData: T) => hydratedData,
  map: <U>() => hydratedData<U>(),
});

const from = <T>(data: T, hydrated: boolean): Hydratable<T> =>
  hydrated ? hydratedData<T>() : serverData<T>(data);

export const hydratable = {
  serverData,
  hydratedData,
  from,
};
