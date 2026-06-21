export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiAttribute {
  name: string;
  type: string;
  format?: string;
  description: string;
  required: boolean;
  pk: boolean;
  fk?: { table: string; column: string };
}

export interface ApiQueryParam {
  name: string;
  type: string;
  description: string;
}

export interface ApiSamples {
  curl: string;
  javascript: string;
  python: string;
  go: string;
}

export interface ApiEndpoint {
  id: string;
  kind: "list" | "retrieve" | "create" | "update" | "delete";
  method: ApiMethod;
  path: string;
  title: string;
  description: string;
  attributes: ApiAttribute[];
  query?: ApiQueryParam[];
  response: string;
  samples: ApiSamples;
}

export interface ApiResource {
  table: string;
  name: string;
  slug: string;
  module: string;
  kind: "table" | "view";
  description: string;
  pk: string;
  endpoints: ApiEndpoint[];
}

export interface ApiModule {
  name: string;
  slug: string;
  resources: ApiResource[];
}

export interface ApiData {
  base: string;
  modules: ApiModule[];
}
