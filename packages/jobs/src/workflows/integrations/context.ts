/**
 * The host shim a piece's `run()` receives.
 *
 * A piece declares far more context than an action normally uses — `store`,
 * `connections`, `project`, `flows`, `step`, `files`. The spike showed stubs are
 * enough for the actions Carbon exposes, so every stub THROWS rather than
 * returning empty: a piece that genuinely needs one must fail loudly in
 * development instead of misbehaving in production.
 */

function unavailable(what: string): never {
  throw new Error(
    `This integration step used ${what}, which Carbon does not provide.`
  );
}

export function buildPieceContext(args: {
  auth: unknown;
  propsValue: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    auth: args.auth,
    propsValue: args.propsValue,
    store: {
      get: () => unavailable("shared storage"),
      put: () => unavailable("shared storage"),
      delete: () => unavailable("shared storage")
    },
    connections: {
      get: () => unavailable("another connection")
    },
    project: {
      id: "carbon",
      externalId: () => unavailable("a project id")
    },
    flows: {
      current: { id: "carbon", version: { id: "carbon" } },
      list: () => unavailable("the flow list")
    },
    step: { name: "carbon" },
    files: {
      write: () => unavailable("file storage")
    },
    // Getters, not empty strings: a piece reading one of these would otherwise send
    // "" to the vendor and fail there instead of here.
    get server(): never {
      return unavailable("the host server URL");
    },
    run: { id: "carbon", stop: () => unavailable("run control") },
    generateResumeUrl: () => unavailable("a resume URL")
  };
}
