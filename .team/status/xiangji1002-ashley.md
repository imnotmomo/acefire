# xiangji1002-ashley

- Role: Product Manager — MVP scope, metric definitions, evidence-first report structure, demo narrative, acceptance criteria and hackathon pitch.
- State: ready_for_implementation_review
- Updated: 2026-10-24
- Working on: The four primary storytelling metrics and their required demo outcomes are documented. The next step is frontend/backend implementation review.
- Active paths: None reserved after this documentation handoff. This update changes `AGENTS.md` and `.team/status/xiangji1002-ashley.md` only.
- Shared contracts: Product requirements only; no API, database, schema or frontend contract changes in this task.
- Handoff: Engineering should use the PM definitions for metric semantics, report ordering, evidence states and demo acceptance in `AGENTS.md`. Keep deterministic calculations with C and implementation ownership with the relevant engineering owner.
- Validation: Documentation reviewed against the confirmed PM work; `git diff --check` passed.
- Blockers: None.

## Confirmed PM decisions

- Product position: evidence-first due diligence without an investment recommendation or overall risk score.
- Hackathon critical path: claim → source locator → deterministic calculation → comparison/refusal → open question.
- Priority metrics: revenue, revenue growth, gross margin, recurring revenue share, top-customer concentration, monthly cash burn, runway and entry revenue multiple.
- Required semantic labels: actual, run-rate, management estimate, investor estimate, external market data, scenario assumption and derived metric.
- Required evidence states: sourced, reproduced, matched, cross-source mismatch, missing underlying evidence, unable to reproduce, period mismatch and definition mismatch.
- Report order: scope, evidence summary, deal terms, operating performance, revenue quality/customers, product/market, financials/cash, valuation/returns, differences, missing evidence, follow-up questions and provenance appendix.
- Demo fixture: use Enfuce's multiple FY2020 revenue values to show that different values may reflect source, period and scenario differences rather than a false statement.
- Four-metric demo sequence: FY2020 revenue for cross-source/definition differences; FY2019 gross margin for successful deterministic reproduction; ST1 top-customer concentration for missing underlying evidence; and runway for explicit refusal when cash balance is unavailable.
- Demo narrative order: difference → verification → evidence gap → refusal and founder follow-up.
- Acceptance rule: every number is sourced, deterministically computed or explicitly refused, with inspectable provenance and non-accusatory wording.
