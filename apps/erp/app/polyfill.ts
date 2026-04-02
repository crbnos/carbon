if (typeof DOMMatrix === "undefined") {
  // @ts-expect-error -- stub for SSR; d3-interpolate uses DOMMatrix for SVG transforms
  globalThis.DOMMatrix = class DOMMatrix {
    constructor() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    }
  };
}

if (typeof Promise.withResolvers === "undefined") {
  Promise.withResolvers = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
