# Ingenium landing page

## Intent

Introduce the existing evidence workspace to investment teams and connect every
Demo CTA to `#/projects`. The root URL becomes the public product introduction;
existing `#/project/...` routes retain their behavior and stored data.

Slogan explicitly selected by the human:
“Trusted diligence, powered by the world’s evidence.”

## Visual system

Keye is the primary visual reference: midnight navy, large uncluttered sans
headlines, periwinkle/royal-blue architectural forms, restrained pale CTAs and
generous space. Original vector sculpture depicts a lens and connected evidence,
not Keye's keyhole mark. Ingenium has its own wordmark and symbol.

Tokens: midnight #111629, panel #1a2036, periwinkle #a4b2ff, blue #6269e9,
paper #eeeef3, secondary #aeb5c9. Font: locally served Manrope Variable;
the workspace retains its existing interface typography.

Page rhythm: asymmetric hero and sculptural illustration; a compact statement of
the problem; interactive workspace preview; a source-to-report process; persona
tabs; an evidence example with selectable claim/formula/source; contact/demo CTA
and a useful footer. Each section answers a different visitor question.

## Content references

- https://www.keye.co/ — dark visual language and product demonstration.
- https://visible.vc/ — explicit audience positioning and clear product paths.
- https://www.alpha-sense.com/ — connected research and source-cited deliverables.
- https://www.getdiscerna.ai/ — concrete source-to-memo narrative.
- https://kapintelligence.com/ai-due-diligence — visible evidence gaps and human review.

References inform structure; their copy, client names, certifications, performance
claims, financial scores and recommendations are not attributed to Ingenium.
UI-UX skill search returned portfolio/gaming treatments twice; those mismatched
results were discarded in favor of the user's explicit Keye direction.

## Truth and handoff

Do not invent customer logos, testimonials, scale statistics or security badges.
Demonstrations are labeled historical examples. The demo opens the real platform;
Enfuce works with local snapshots, Circle requires the prepared data backend.
The landing page does not add extraction, a live AI chat service, or data vendors.

The human supplied hello@ingenium.ai as the public contact address and a content
framework covering the problem, three investment-team personas, Ingest / Trace /
Verify / Decide, five core capabilities, Team / Professional / Enterprise SaaS
plans, and evidence-led decision support. Book a Demo and See the Platform both
open the existing workspace; Contact and pricing links open an email draft.
`VITE_CONTACT_EMAIL` can override the public inbox. No email is sent automatically,
no appointment is claimed, and no checkout or subscription purchase is implemented.
Enterprise security/integration requirements are discussions, not certifications.

Maintain CSS scope under `.ingenium-site` and `.ig-*`; preserve the platform API,
decimal strings, source contracts, localStorage keys and IndexedDB database names.
