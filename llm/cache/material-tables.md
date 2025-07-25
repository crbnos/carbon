# Material Tables Schema

## Overview

Carbon implements a comprehensive material management system with separate tables for material properties including dimensions, finishes, and grades. These tables were created in migration `20250719100358_material-seed.sql`.

## Material Table

The main `material` table stores material records with the following columns:

- `id`: string (primary key)
- `companyId`: string (required)
- `materialFormId`: string | null (references materialForm table)
- `materialSubstanceId`: string | null (references materialSubstance table)
- `dimensions`: string | null (now references materialDimension.id)
- `finish`: string | null (now references materialFinish.id)
- `grade`: string | null (now references materialGrade.id)
- `approved`: boolean
- `approvedBy`: string | null
- `customFields`: Json | null
- `tags`: string[] | null
- `externalId`: Json | null
- `createdAt`: string
- `createdBy`: string
- `updatedAt`: string | null
- `updatedBy`: string | null

## Material Property Tables

### materialDimension Table

Stores material dimensions specific to material forms:

- `id`: string (primary key)
- `materialFormId`: string (required, references materialForm)
- `name`: string (required)
- `companyId`: string | null (for company-specific dimensions)

Has a unique constraint on `(materialFormId, name, companyId)`.

### materialFinish Table

Stores material finishes specific to material substances:

- `id`: string (primary key)
- `materialSubstanceId`: string (required, references materialSubstance)
- `name`: string (required)
- `companyId`: string | null (for company-specific finishes)

Has a unique constraint on `(materialSubstanceId, name, companyId)`.

### materialGrade Table

Stores material grades specific to material substances:

- `id`: string (primary key)
- `materialSubstanceId`: string (required, references materialSubstance)
- `name`: string (required)
- `companyId`: string | null (for company-specific grades)

Has a unique constraint on `(materialSubstanceId, name, companyId)`.

## Views

Each property table has an associated view that joins with the parent table:

- `materialDimensions`: Joins with materialForm to include `formName`
- `materialFinishes`: Joins with materialSubstance to include `substanceName`
- `materialGrades`: Joins with materialSubstance to include `substanceName`

## Key Relationships

1. **Material → MaterialDimension**: The `dimensions` column in the material table references `materialDimension.id`
2. **Material → MaterialFinish**: The `finish` column in the material table references `materialFinish.id`
3. **Material → MaterialGrade**: The `grade` column in the material table references `materialGrade.id`
4. **MaterialDimension → MaterialForm**: Each dimension is specific to a form (e.g., sheet, plate, round bar)
5. **MaterialFinish → MaterialSubstance**: Each finish is specific to a substance (e.g., steel, aluminum)
6. **MaterialGrade → MaterialSubstance**: Each grade is specific to a substance

## System vs Company Data

All three property tables support both system-wide and company-specific entries:
- System entries have `companyId = null` and are available to all companies
- Company-specific entries have a `companyId` value and are only available to that company

The migration seeds the database with comprehensive system-wide entries for common dimensions, finishes, and grades across various material forms and substances.