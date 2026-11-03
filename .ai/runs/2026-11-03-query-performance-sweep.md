# Query performance sweep — run log

Plan: `.ai/plans/2026-11-03-query-performance-sweep.md`
Branch: `perf/query-sweep`

## Task 1

Stack: `crbn up --no-apps` in the worktree, Postgres `postgresql://postgres:postgres@localhost:55478/postgres` (7 seed purchase invoices, 1 company, `test@carbon.ms`).

The harness takes `newview`, `newview_name`, `oldview` and `shapes`. The verify run (600 copies, 96 companies) finished with no error.

Deviation: the plan expected 2 matches of "page 50"; the run prints 6, because 3 of the 6 shapes are named "page 50" and each prints in 2 tables. The plan now says 6.

Gap for later tasks: the copy step seeds purchase invoices only. A task that benchmarks another view must add a copy step for its tables.

## Task 2

## Task 3

## Task 4

## Task 5

## Task 6

## Task 7

## Task 8

## Task 9

## Task 10

## Task 11

## Task 12

## Task 13

## Task 14

## Task 15

## Task 16

## Task 17

## Task 18

## Task 19

## Task 20

## Task 21

## Task 22

## Task 23

## Task 24

