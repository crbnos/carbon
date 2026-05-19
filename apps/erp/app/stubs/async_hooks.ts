export class AsyncLocalStorage<T> {
  getStore(): T | undefined {
    return undefined;
  }

  run<R>(
    _store: T,
    callback: (...args: unknown[]) => R,
    ..._args: unknown[]
  ): R {
    return callback();
  }
}
