// Runtime shims for environments without browser globals (Node SSR, the Inngest
// jobs worker). Import for side effects — `import "@carbon/lib/shims"` — at each
// runtime entry, before anything that touches these globals (notably pdfjs-dist,
// whose module init runs `new DOMMatrix()`, and d3-interpolate's SSR transforms).

// Returns a plain identity matrix instead of a real instance: consumers only read
// the a–f components, and this keeps the class body dependency-free.
export class DOMMatrixShim {
  constructor() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
}

const g = globalThis as any;

if (typeof g.DOMMatrix === "undefined") {
  g.DOMMatrix = DOMMatrixShim;
}

if (typeof (Promise as any).withResolvers === "undefined") {
  (Promise as any).withResolvers = function withResolvers() {
    let resolve: (value: unknown) => void;
    let reject: (reason?: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve: resolve!, reject: reject! };
  };
}
