# PostgreSQL SQL Style Guide

## General

- Use uppercase for SQL reserved words to maintain consistency and readability.
- Employ consistent, descriptive identifiers for tables, columns, and other database objects.
- Use white space and indentation to enhance the readability of your code.
- Store dates in ISO 8601 format (`yyyy-mm-ddThh:mm:ss.sssss`).
- Include comments for complex logic, using '/_ ... _/' for block comments and '--' for line comments.

## Naming Conventions

- Avoid SQL reserved words and ensure names are unique and under 63 characters.
- Use camelCase for tables and columns.
- Prefer singular for table names
- Prefer plural for views
- Prefer singular names for columns.

## Tables

- Avoid prefixes like 'tbl\_' and ensure no table name matches any of its column names.
- Always add an `id` column of type `TEXT DEFAULT xid()` unless otherwise specified. Use it as the primary key.
- Always add the schema to SQL queries for clarity.
- Always add a `companyId` column of type `TEXT NOT NULL` that references `company("id")` unless otherwise specified.
- Always include an `assignee` column which references `user("id")` unless otherwise specified
- Always include a `customFields` column of type `JSONB` unless otherwise specified.
- Always include a `createdBy`, `createdAt`, `updatedBy` and `updatedAt` column unless otherwise specified.

## Columns

- Use singular names and avoid generic names like 'id'.
- For references to foreign tables, use the singular of the table name with the `Id` suffix. For example `userId` to reference the `user` table
- Always use lowercase except in cases involving acronyms or when readability would be enhanced by an exception.

#### Examples:

```sql
CREATE TABLE "quote" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "quoteId" TEXT NOT NULL,
  "revisionId" INTEGER NOT NULL DEFAULT 0,
  "salesRfqId" TEXT,
  "dueDate" DATE,
  "expirationDate" DATE,
  "status" "quoteStatus" NOT NULL DEFAULT 'Draft',
  "notes" JSON DEFAULT '{}'::json,
  "salesPersonId" TEXT,
  "estimatorId" TEXT,
  "customerId" TEXT NOT NULL,
  "customerLocationId" TEXT,
  "customerContactId" TEXT,
  "customerReference" TEXT,
  "locationId" TEXT,
  "assignee" TEXT,
  "customFields" JSONB,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "quote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quote_quoteId_key" UNIQUE ("quoteId", "companyId"),
  CONSTRAINT "quote_salesRfqId_fkey" FOREIGN KEY ("salesRfqId") REFERENCES "salesRfq" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "quote_customerLocationId_fkey" FOREIGN KEY ("customerLocationId") REFERENCES "customerLocation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_customerContactId_fkey" FOREIGN KEY ("customerContactId") REFERENCES "customerContact" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quote_estimatorId_fkey" FOREIGN KEY ("estimatorId") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quote_assignee_fkey" FOREIGN KEY ("assignee") REFERENCES "user" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "quote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quote_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
```

## Queries

- When the query is shorter keep it on just a few lines. As it gets larger start adding newlines for readability
- Add spaces for readability.

Smaller queries:

```sql
SELECT *
FROM "employee"
WHERE "endDate" IS NULL;

UPDATE "employee"
SET "endDate" = '2023-12-31'
WHERE "id" = '1234';
```

Larger queries:

```sql
SELECT
  "firstName",
  "lastName"
FROM
  "employee"
WHERE
  "startDate" BETWEEN '2021-01-01' AND '2021-12-31'
AND
  "status" = 'employed';
```

### Joins and Subqueries

- Format joins and subqueries for clarity, aligning them with related SQL clauses.
- Prefer full table names when referencing tables. This helps for readability.

```sql
SELECT
  "employee"."employeeName",
  "department"."departmentName"
FROM
  "employee" e
JOIN
  "department" d on e."departmentId" = d."id"
WHERE
  "employee"."startDate" > '2022-01-01';
```

## Aliases

- Use meaningful aliases that reflect the data or transformation applied, and always include the 'as' keyword for clarity.

```sql
SELECT count(*) AS "totalEmployees"
FROM "employee"
WHERE "endDate" IS NULL;
```

## Complex queries and CTEs

- If a query is extremely complex, prefer a CTE.
- Make sure the CTE is clear and linear Prefer readability over performance.
