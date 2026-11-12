# Conditional corrections — research

Date: 2026-11-10
Spec: `.ai/specs/2026-11-10-conditional-corrections.md`

## Question

How do MES products route a unit through a correction chosen by an inspection
result, then back into the normal routing?

## Findings

| Product | Pattern |
|---|---|
| SAP Digital Manufacturing | A nonconformance (NC) code points to a disposition routing: an NC routing for repair, or a disposition function routing for one action. An out-of-limit data-collection value can log the NC code and disposition the unit to the rework routing automatically. SAP advises one disposition routing per NC code. Older SAP ME offers "return to original / previous step" disposition functions. |
| AVEVA MES | Separates conditional routing (next job depends on a condition) from dynamic routing (mainly rework). Dynamic routing builds rework jobs at run time from a predefined process, keyed to a reason and a routing code. |
| Infor MES | Rework is an extra job on the same production order. After rework, the material is routed back to where it resumes. |
| Critical Manufacturing | Conditional flows route material by condition; inspection outcomes accept, reject or send units for repair. |
| Epicor (user practice) | Failed parts are sent back to an earlier operation; time is charged there. No native branching. |

## Consensus

Result or defect code → predefined correction routing → return to a resume
point, usually the inspection that found the problem. The correction is defined
ahead of time and instantiated for the unit at run time. One code maps to one
correction.

## Carbon today

- Rework copies the operations from a chosen earlier operation through the
  triggering one, after the triggering one (`cloneReworkOperations`,
  `apps/erp/app/modules/production/production.service.ts`). The copy of an
  inspection operation re-inspects.
- The copies are not scoped to the reworked units: every open unit of the make
  method shows as not done at them.
- No operation or step is conditional or skippable.

## Sources

- SAP Learning, "Creating Nonconformance Routings": https://learning.sap.com/courses/configuring-sap-digital-manufacturing-for-execution-basic-data-and-configuration/creating-nonconformance-routings
- SAP blog, "Automatic disposition to rework after out-of-limit data collection": https://blogs.sap.com/t5/product-lifecycle-management-blogs-by-sap/automatic-disposition-to-rework-after-out-of-limit-data-collection-within/ba-p/13574594
- SAP ME help, disposition functions: https://help.sap.com/saphelp_me60/helpdata/EN/40/2db4643b2547379555c562bdbbadb5/content.htm
- AVEVA MES, dynamic routing: https://docs.aveva.com/bundle/manufacturing-execution-system/page/1295092.html
- AVEVA MES, configure dynamic routing usage: https://docs.aveva.com/bundle/manufacturing-execution-system-7.0/page/74925.html
- Infor MES, rework: https://docs.infor.com/mes/2026.x/en-us/mesuaal/inv_guide/xoi1679057609459.html
- Critical Manufacturing, smart routing for defect classification: https://devblog.criticalmanufacturing.com/blog/20250604_smart_routing_for_defect_classification/
- Epicor user forum, job routing: https://www.epiusers.help/t/job-routing/115617
