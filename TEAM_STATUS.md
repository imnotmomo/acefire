# Shared team status

Read the per-person status files before choosing files to edit. Each teammate's
agent updates its own file; separate files reduce editing conflicts.

| Teammate | Role | Current status |
| --- | --- | --- |
| [imnotmomo](.team/status/imnotmomo.md) | Database, calculations, reports and numeric traceability | C backend and Circle report/evidence frontend integrated; uploads/Akta pending for B; see status file |
| [chr950331](.team/status/chr950331.md) | B: document/Akta extraction, sponsor model integration and source-bound handoff | Local pipeline validated; Enfuce Deck found; numeric contract adaptation and Enfuce onboarding pending |
| [xiangji1002-ashley](.team/status/xiangji1002-ashley.md) | | Not reported |
| [XINWENGAri](.team/status/XINWENGAri.md) | Frontend workspace, report workflow, evidence/lineage UI and website documentation | Local prototype delivered and validated; C report/lineage API integration pending; see status file |

The frontend owner's status records the earlier prototype handoff. Current Circle
API integration and validation are recorded by C in `imnotmomo.md`; C has not
modified another teammate's status file.

The remaining blank role assignments are intentional. Their owners can add confirmed
work in their own status file. This index is a convenience; the per-person file
is the detailed handoff.

Current product flow: **B extracts PDF/Akta data → C stores, calculates and
returns traceable company reports → frontend renders reports and file graphs.**

B's current business input is the 31-page Enfuce April 2020 company/funding
Deck, with Memo, FDD and source documents as supplements. C's committed adapters
still use Circle. B's local code/artifacts have not yet been merged into the
shared backend; this status update does not imply Enfuce ingestion is complete.

These are repository records, not a live presence system. Other checkouts and
agents see updates after normal Git synchronization. Do not infer that a task
is idle merely because its status has not changed recently.
