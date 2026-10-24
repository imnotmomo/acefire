# Shared team status

Read the per-person status files before choosing files to edit. Each teammate's
agent updates its own file; separate files reduce editing conflicts.

| Teammate | Role | Current status |
| --- | --- | --- |
| [imnotmomo](.team/status/imnotmomo.md) | Database, calculations, reports and numeric traceability | Firebase-backed Circle/Enfuce, source-cited LLM reports/calculations/chat integrated; uploads/Akta pending for B |
| [chr950331](.team/status/chr950331.md) | B: document/Akta extraction, sponsor model integration and source-bound handoff | Document extraction/intake and 12-module sourced narrative delivered; C imported Enfuce reports; B Chat upload deferred |
| [xiangji1002-ashley](.team/status/xiangji1002-ashley.md) | Product scope, semantic layer, metric catalog and hackathon pitch | Integrating the latest product into a pitch-ready contract and demo narrative |
| [XINWENGAri](.team/status/XINWENGAri.md) | Frontend workspace, report workflow, evidence/lineage UI and website documentation | Local prototype delivered and validated; C report/lineage API integration pending; see status file |

The frontend owner's status records the earlier prototype handoff. Current Circle
API integration and validation are recorded by C in `imnotmomo.md`; C has not
modified another teammate's status file.

The remaining blank role assignments are intentional. Their owners can add confirmed
work in their own status file. This index is a convenience; the per-person file
is the detailed handoff.

Current product flow: **B extracts PDF/Akta data → C stores, calculates and
returns traceable company reports → frontend renders reports and file graphs.**

PM product flow: **the investment firm defines a reusable semantic layer and
metric catalog → each new project resolves those definitions against its own
data room → C records the calculation and provenance → the frontend shows the
result, evidence, assumptions and gaps.** The current code provides the generic
calculation/evidence/report primitives; automatic catalog execution for every new
project is the next productization layer, not a completed production claim.

B's validated source run uses the 31-page Enfuce April 2020 Deck. See
`backend/B_WORKFLOW.md` for extraction, DuckDB handoff, source-bound narrative
and status contracts. C's latest Firebase importer already preserves B's stored
reports/claims; C's status and `FIREBASE_INTEGRATION.md` describe its own app work.
Private runtime/source assets are not synchronized by Git. B's separate Chat
feature is explicitly deferred from this publication.

These are repository records, not a live presence system. Other checkouts and
agents see updates after normal Git synchronization. Do not infer that a task
is idle merely because its status has not changed recently.
