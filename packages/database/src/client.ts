// This is a barrel file that re-exports everything from database.ts
// As Supabase functions have limitations on module resolution,
// we directly re-export from the database.ts file here.
export * from "../supabase/functions/lib/postgres/index.ts";
