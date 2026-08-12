# Join semantics after a conditional branch — how other engines solve it

Research date: 2026-08-10. Question: a join must wait for all incoming branches, but some
branches are never taken — when does it stop waiting?

## 1. BPMN / BPEL — dead path elimination and the OR-join

**BPEL (the origin).** A BPEL activity has a *join condition*: a boolean function over the
status of its incoming links. "Once every incoming link has fired, the join condition is
evaluated." With `suppressJoinFailure="yes"`, "the activity associated with a false join
condition is skipped and the false link status is propagated along links leaving that
activity. A false link status will be propagated transitively along entire paths formed by
successive links until a join condition is reached that evaluates to true. This approach is
called Dead-Path Elimination (DPE)."
([Understanding Join Behavior](http://documentation.microfocus.com/help/topic/com.attachmate.eclipse.compositeservices.bpel.designer.help.online/tasks/pd_join_behavior.xhtml),
[BPEL 2.0](https://www.researchgate.net/publication/249664807_Web_Services_Business_Process_Execution_Language_Version_20))

Key property: **the join never waits for a signal that will not come, because a not-taken edge
still delivers a signal — a negative one.** Every edge is eventually `true` or `false`. This is
the formulation worth copying.

**BPMN inclusive gateway (OR-join).** BPMN dropped explicit link status, so the join has to
*infer* when to stop waiting. Camunda 8 states the rule as: the merge completes when either
"All incoming sequence flows have been taken at least once" **or** "No path exists from any
active flow node to the inclusive gateway (excluding incoming paths to the inclusive gateway
that have already been taken)."
([Camunda 8 inclusive gateway](https://docs.camunda.io/docs/components/modeler/bpmn/inclusive-gateways/))

That second clause is a **global reachability query over live tokens** — it is why the
OR-join is considered hard:

- It is *non-local*: you cannot decide the gateway from its own incoming edges; you must
  inspect whole-instance state. Camunda's failure mode: if an awaited token takes a different
  turn and can no longer reach the join (interrupting boundary event), the join must notice or
  the process hangs.
- **Vicious circles**: "Two or more OR-joins may mutually depend on each other as one OR-join
  can be executed only if the other is not and vice versa." No fixpoint exists.
  ([van der Aalst, *On the semantics of EPCs: A vicious circle*](https://www.vdaalst.com/publications/p170.pdf))
- With loops the reachability question needs reset nets, and soundness for reset-arc workflow
  nets is undecidable.
  ([van der Aalst et al.](https://www.vdaalst.rwth-aachen.de/publications/p464.pdf),
  [Semantics of Standard Process Models with OR-Joins](https://link.springer.com/chapter/10.1007/978-3-540-76848-7_5))
- Practical consequence: Camunda 8 **ships only the diverging inclusive gateway; converging
  (join) is unsupported.** ([camunda/camunda#10031](https://github.com/camunda/camunda/issues/10031))

Takeaway: BPEL-style dead-path propagation is tractable; BPMN-style "infer from reachability"
is not. For an acyclic engine there is no reason to pick the latter.

## 2. Airflow — trigger rules and the `skipped` state

Airflow gives every task a `trigger_rule` evaluated against upstream *states*, and adds
`skipped` as a first-class terminal state alongside `success`/`failed`.
([Astronomer: trigger rules](https://www.astronomer.io/docs/learn/airflow-trigger-rules))

| Rule | Fires when |
|---|---|
| `all_success` (default) | all upstream succeeded |
| `none_failed` | all upstream succeeded **or were skipped** |
| `none_failed_min_one_success` | no upstream `failed`/`upstream_failed`, **and ≥1 succeeded** |
| `all_done` | all upstream finished, any state |
| `none_skipped` / `one_success` / `one_failed` / `one_done` / `all_skipped` / `all_failed` / `always` | as named |

**Skip propagation.** `@task.branch` returns the id(s) to follow; "The specified task is
followed, while all other paths are skipped." Skips then cascade: "Skipped tasks will cascade
through trigger rules `all_success` and `all_failed`, and cause them to skip as well" — i.e.
the skip spreads by ordinary rule evaluation, not by a separate graph walk.

**The critical carve-out** (Airflow docs, DAGs / Branching):
> "When a Task is downstream of both the branching operator *and* downstream of one or more
> of the selected tasks, it will not be skipped."

That single sentence is the answer to "don't skip a node that a live path also reaches".
([Airflow: DAGs / Branching](https://airflow.apache.org/docs/apache-airflow/stable/core-concepts/dags.html))

**Recommended join rule:** `none_failed_min_one_success` — the join "can run so long as at least
one of the branches has succeeded and none of the branches have failed", "instead of getting a
cascaded skip". Rough edge: [apache/airflow#19222](https://github.com/apache/airflow/issues/19222)
— mis-evaluates in some branch topologies and skips anyway.

## 3. Other engines

**Argo Workflows** — closest to what a small DAG engine should do. `depends` is a boolean
expression over upstream *result tags*: `.Succeeded`, `.Failed`, `.Errored`, `.Skipped`
("Task's `when` condition evaluated to `false`"), `.Omitted` ("Task's `depends` condition
evaluated to `false`"), `.Daemoned`. A plain `depends: A` desugars to
**`(A.Succeeded || A.Skipped || A.Daemoned)`** — a *skipped* upstream satisfies the dependency
by default, an *omitted* one does not, and omission propagates. "A Skipped or Omitted task
never runs, so it produces no output parameters or results"; references "resolve to empty
strings." `.Omitted` only arrived in 3.3.9 and the gap caused real bugs.
([docs](https://argo-workflows.readthedocs.io/en/latest/enhanced-depends-logic/),
[#8654](https://github.com/argoproj/argo-workflows/issues/8654),
[#10321](https://github.com/argoproj/argo-workflows/issues/10321))

**AWS Step Functions** — sidesteps it. `Choice` is a *transition*, not a fork: it evaluates
rules in order and jumps to one `Next`. No join construct exists for `Choice`; the only join is
implicit at the end of `Parallel`/`Map`, which "waits until all branches terminate". Converging
after a `Choice` = point several branches' `Next` at the same state — first arrival runs it.
([Choice](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html),
[Parallel](https://docs.aws.amazon.com/step-functions/latest/dg/state-parallel.html))

**Temporal** — no DAG at all. Branch/join are language constructs (`if`, `await Promise.all`);
the join is whatever the code awaits, so the untaken-branch problem cannot arise. Cost is the
replay determinism constraint. ([docs](https://docs.temporal.io/workflow-definition))

**n8n** — most instructive failure. Merge modes are Append, Combine (matching fields /
position / all combinations), SQL Query, Choose Branch; it "waits for the execution of all
connected inputs." After an `IF` node the unexecuted branch never delivers, so **Merge stalls
or emits partial data**. Community workaround: set "Always Output Data" on the node before
Merge so an empty item is emitted — a hand-rolled dead-path signal. Merge in wait/passthrough
mode has also been reported to *execute* nodes behind the untaken IF branch — the opposite
bug, and evidence that "run it when data shows up" is not a semantics.
([docs](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.merge/),
[#6596](https://github.com/n8n-io/n8n/issues/6596),
[#3949](https://github.com/n8n-io/n8n/issues/3949),
[#13593](https://github.com/n8n-io/n8n/issues/13593))

**Zapier Paths** — refuses the feature. "Paths do not merge back into one common downstream
workflow"; the supported answer is a Sub-Zap or a second Zap.
([Paths](https://help.zapier.com/hc/en-us/articles/8496288555917-Add-branching-logic-to-Zaps-with-Paths), [community](https://community.zapier.com/how-do-i-3/is-there-a-way-to-merge-paths-back-together-112))

### Comparison

| Engine | Untaken branch is… | Join fires when | Global analysis needed |
|---|---|---|---|
| BPEL + DPE | a `false` link signal, propagated transitively | every incoming link has a status | no |
| BPMN OR-join | nothing (absence) | all taken flows arrived **or** unreachable from any live token | **yes** |
| Airflow | task in `skipped` state | trigger rule over upstream states | no (local) |
| Argo | `Omitted` / `Skipped` result tag | `depends` expression is true | no (local) |
| Step Functions | not a branch at all | n/a — first arrival wins | no |
| n8n | absence → stall | all inputs delivered (bug-prone) | no |
| Zapier | n/a | never — merging unsupported | — |

## 4. Recommended algorithm (BFS engine, acyclic graph)

This is BPEL dead-path elimination with Airflow's carve-out, expressed as edge states. Every
edge ends in exactly one of `Live` (source completed, handle taken) or `Dead` (source skipped,
or handle not taken). No edge is left undecided — that is the whole trick.

```
STATE:  each node ∈ {Pending, Running, Completed, Failed, Skipped}
        each edge ∈ {Unknown, Live, Dead}

READY(n):    every incoming edge is Live or Dead, AND ≥1 incoming edge is Live
SKIPPED(n):  every incoming edge is Dead                       // no live path reaches n

on node n reaching a terminal state:
  if Completed:
     for each outgoing edge e (handle h):
        e := (h ∈ takenHandles(n)) ? Live : Dead
  if Skipped:  all outgoing edges := Dead
  if Failed:   all outgoing edges := Dead, and mark the run Failed
                                                  // or Dead + run continues, see below

then, for every node m whose incoming edges are now all resolved:
  if SKIPPED(m): set m = Skipped (cascade above resolves its outgoing edges)
  elif READY(m): enqueue m
```

Properties, and why they matter:

- **Edge-state, not node-state.** Readiness is a pure function of a node's own incoming edges.
  No reachability query, no vicious circle, no OR-join hardness (§1).
- **A node with ANY Live incoming edge is never skipped** — exactly Airflow's "downstream of
  both the branching operator and one of the selected tasks → not skipped". Makes diamonds work.
- **Skip is a real terminal state, not an absence.** Record a `Skipped` step row so run history
  explains *why* the join fired (matches Argo `.Omitted`, and Carbon's existing `Skipped`
  status in `workflow-run-history.md`).
- BFS is safe because resolution is monotone: edges only go Unknown → resolved.

## 5. Edge cases that bite

1. **Diamond / re-convergence.** `cond →true→ A → J` and `cond →false→ B → J`, plus
   `trigger → J`. Naively cascading skip down the false branch would skip `J`. The `≥1 Live`
   guard prevents it. Test this first; it is the case every engine gets wrong once.
2. **Node reachable from both a taken and untaken path.** Same rule, but note the *ordering*
   hazard: if you evaluate `J` the moment the dead edge resolves, before `A` finishes, `J`
   still has an `Unknown` edge and must stay Pending. Never decide a node until **all**
   incoming edges are resolved.
3. **Nested conditions.** Skip must propagate transitively — a skipped condition node emits
   `Dead` on *all* handles, including the one its (unevaluated) expression "would" have taken.
   Do not evaluate a skipped condition.
4. **Failed vs Skipped upstream.** Must stay distinct. Skipped = "path not chosen, carry on";
   Failed = "path chosen and broke". If failure silently becomes a dead edge, a downstream join
   fires as if the branch was never wanted and the run reports success. Decide once: either
   failure aborts the run (simplest, matches `all_success`), or it marks edges Dead *and* marks
   the run Failed. Airflow keeps a separate `upstream_failed` state for this; Argo separates
   `.Failed` / `.Errored` / `.Skipped` / `.Omitted`.
5. **Terminal / unconnected handles.** A handle with no outgoing edge is not an error — the
   branch just ends. But if the *taken* handle is unconnected while another handle feeds a join,
   the join gets only Dead edges and is correctly Skipped; surface that as `Skipped`, not a hung
   run. Mirrors Step Functions: a `Choice` with no matching rule and no `Default` errors — pick
   whether "no handle matched" is skip or failure, and be consistent.
6. **Multiple handles true at once** (inclusive split). Free here — mark several edges Live and
   the join waits for all. This is the case BPMN finds hard and edge-state makes trivial.
7. **Unreached nodes in the run log.** Nodes whose edges never resolve (ancestor failed, run
   aborted) get no step row. Render "Not reached", distinct from `Skipped` — Carbon already does
   this in `WorkflowRunSteps`.
8. **Cycles.** Assumes a DAG. With a back-edge, "all incoming edges resolved" never becomes true
   and the run stalls silently. Validate acyclicity at save time — that assumption is what buys
   the whole simplification over BPMN.
