# Overview

> Carbon is a manufacturing system: ERP for the office, MES for the floor. These are the technical docs.

Carbon is a manufacturing system: **ERP** for the office (orders, purchasing, planning, accounting) and
**MES** for the floor (jobs, operations, tracking). One platform over one data model.

These are the **technical docs**: exact behavior, fields, and operations. If you're new, start with the
narrated `guides/order`, which walks one order from the sales desk to a shipped, traceable robot.
Come here when you already know the noun you need and want the precise detail behind it.

## How the docs are organized

  - Architecture How Carbon is built: apps, packages, database, events, jobs, and auth.
  - Self-hosting Run Carbon on your own infrastructure — a single VPS with Docker, or your own AWS account with SST.
  - Environment variables Every variable that configures a Carbon instance, grouped by concern.
  - Reference The entities behind the Guide: methods, reordering, routings, and more.
