import type { Project, Workspace, Section } from './domain'
import { defaultConfig } from './domain.ts'
import { MODULES } from './data.ts'
import type { Evidence, ModuleId } from './data'

export const DEMO_PROJECTS: Project[] = [
  { id: 'enfuce-documents', backendDealId: 'enfuce-2020', name: 'Enfuce', sector: 'Fintech', geography: 'Finland', created: '2026-10-24T12:00:00Z' },
  { id: 'healthtech-demo', name: 'HealthTech / Biotech', sector: 'HealthTech / Biotech', geography: 'US · illustrative', created: '2026-10-24T12:00:00Z' },
  { id: 'marketplace-demo', name: 'Consumer / Marketplace', sector: 'Consumer / Marketplace', geography: 'US · illustrative', created: '2026-10-24T12:00:00Z' },
]
export function migrateDemoProjects(stored: unknown): Project[] {
  const valid = Array.isArray(stored) ? stored.filter((p): p is Project => Boolean(p && typeof p.id === 'string' && typeof p.name === 'string')) : []
  // Add UI examples without removing or rewriting existing company identities or metadata.
  return [...DEMO_PROJECTS.map(demo => valid.find(project => project.id === demo.id) ?? { ...demo }), ...valid.filter(project => !DEMO_PROJECTS.some(demo => demo.id === project.id))]
}
export type DemoStatus = 'Verified' | 'Unsupported' | 'Contradicted'
export type ScenarioClaim = { id: string; title: string; claim: string; status: DemoStatus; internal: string; external: string; conclusion: string; evidenceId: string; module: ModuleId; channel: string }
export type DemoScenario = { id: string; question: string; title: string; description: string; stages: string[]; claims: ScenarioClaim[]; evidence: Evidence[] }
const HEALTH: ScenarioClaim[] = [
  { id: 'accuracy', title: 'Clinical accuracy', claim: 'Clinical accuracy reaches 94%.', status: 'Unsupported', internal: 'Illustrative pitch deck reports 94% on a retrospective single-site dataset.', external: 'The simulated literature review has no prospective multi-site result for this fictional product.', conclusion: 'The 94% company claim is not an independently validated clinical result. Request the protocol, patient mix, comparator and external validation.', evidenceId: 'demo-health-accuracy', module: 'clinical', channel: 'ClinicalTrials.gov / PubMed' },
  { id: 'market', title: 'Addressable market', claim: 'Our market exceeds $10B.', status: 'Contradicted', internal: 'The illustrative market slide counts all diagnostic imaging spend.', external: 'The simulated market review covers a narrower AI diagnostic software segment and a different buyer population.', conclusion: 'The cited market definition does not support the presented addressable market. Rebuild the scope before comparing values.', evidenceId: 'demo-health-market', module: 'market', channel: 'Market research / competing products' },
  { id: 'pilots', title: 'Hospital pilots', claim: 'We have completed multiple hospital pilots.', status: 'Verified', internal: 'The fictional pilot register lists two completed feasibility projects.', external: 'Two simulated hospital-announcement excerpts corroborate feasibility participation only.', conclusion: 'Pilot participation is supported within this simulation. It does not establish clinical efficacy, paid deployment or hospital-wide adoption.', evidenceId: 'demo-health-pilots', module: 'customers', channel: 'Hospital partnership announcements' },
  { id: 'fda', title: 'Regulatory pathway', claim: 'The FDA pathway is clear.', status: 'Unsupported', internal: 'The illustrative regulatory memo proposes a predicate-based route without an agency determination.', external: 'The simulated FDA evidence pack contains no product-specific clearance or confirmed pathway.', conclusion: 'A proposed pathway is not clearance. Request the documented agency feedback and intended-use comparison.', evidenceId: 'demo-health-fda', module: 'clinical', channel: 'FDA records' },
]
const CONSUMER: ScenarioClaim[] = [
  { id: 'gmv', title: 'Growth quality', claim: 'GMV grew 150%, proving strong demand.', status: 'Contradicted', internal: 'The fictional finance pack shows GMV growth alongside heavier discounts and subsidies. Reported revenue growth relies on promotion-led orders; net revenue and subsidy accounting need reconciliation.', external: 'The simulated category traffic review does not show comparable organic demand growth.', conclusion: 'GMV is not revenue or contribution profit. Separate subsidized activity from sustainable demand before relying on the growth story.', evidenceId: 'demo-consumer-gmv', module: 'financials', channel: 'Financial pack / Similarweb-style traffic review' },
  { id: 'users', title: 'User conversion', claim: 'Rapid user growth translates into more paying customers.', status: 'Contradicted', internal: 'The illustrative cohort file shows MAU growth outpacing paying-user growth.', external: 'Simulated App Store and Reddit review excerpts raise concerns about repeat purchase and promotional users.', conclusion: 'Top-of-funnel activity is not growing in step with paid conversion. Review retention and paying-user cohorts separately.', evidenceId: 'demo-consumer-users', module: 'customers', channel: 'User metrics / App Store / Reddit' },
  { id: 'cac', title: 'Unit economics', claim: 'Unit economics keep improving.', status: 'Contradicted', internal: 'The fictional acquisition ledger shows rising CAC and higher promotional spend.', external: 'The simulated competitor review highlights increased acquisition competition.', conclusion: 'Reconcile CAC, retention, take rate and contribution margin using the same period and cohort; do not infer LTV from GMV.', evidenceId: 'demo-consumer-cac', module: 'economics', channel: 'Acquisition ledger / competitor evidence' },
  { id: 'leadership', title: 'Market leadership', claim: 'We are the clear market leader.', status: 'Unsupported', internal: 'The illustrative deck repeats an older market-size citation without a current share denominator.', external: 'The simulated market evidence uses a more recent period and a narrower serviceable segment.', conclusion: 'The leadership narrative is not supported by a current comparable share measure. Refresh the citation and market scope.', evidenceId: 'demo-consumer-leadership', module: 'market', channel: 'Market research / external traffic evidence' },
]
function makeScenario(id: string, question: string, title: string, description: string, stages: string[], claims: ScenarioClaim[]): DemoScenario {
  const evidence: Evidence[] = claims.map(item => ({ id: item.evidenceId, title: item.title, file: `SIMULATED · ${item.title} evidence pack`, locator: 'Illustrative record · not an original document locator', period: 'Fictional demo period', unit: 'Illustrative claim', status: item.status === 'Verified' ? 'Reported' : 'Needs review', value: item.claim, description: item.conclusion, excerpt: `SIMULATED INTERNAL: ${item.internal}\n\nSIMULATED EXTERNAL: ${item.external}`, rows: [['Company claim', item.claim], ['Internal evidence · simulated', item.internal], ['External evidence · simulated', item.external], ['Example assessment', item.status]], note: `SIMULATED EXAMPLE — no live source retrieval or independent verification. ${item.conclusion}`, category: 'Documents' }))
  return { id, question, title, description, stages, claims, evidence }
}
export const SCENARIOS: DemoScenario[] = [
  makeScenario('healthtech-demo', 'Can we trust the claims?', 'Internal claims. External scrutiny.', 'A fictional AI diagnostics company raising Series A/B funding. Compare clinical, commercial and regulatory claims with clearly labeled example evidence.', ['Company claim', 'Internal evidence', 'External evidence', 'Assessment'], HEALTH),
  makeScenario('marketplace-demo', 'Can we trust the investment story?', 'Narrative vs Reality', 'A fictional high-growth consumer marketplace. Follow the founder narrative through financials, user metrics and external market signals to reveal investment questions.', ['Founder narrative', 'Financial data', 'User metrics', 'External market evidence', 'Investment risk'], CONSUMER),
]
export function getScenario(id: string): DemoScenario | undefined { return SCENARIOS.find(item => item.id === id) }
export function scenarioSections(scenario: DemoScenario, workspace: Workspace): Section[] {
  return workspace.order.map(id => {
    const module = MODULES.find(item => item.id === id)!
    const config = workspace.configs[id] ?? defaultConfig(id)
    const claims = config.topics.length ? scenario.claims.filter(item => item.module === id || id === 'overview' || id === 'questions') : []
    const content = claims.length ? claims.map(item => `${item.claim}\nExample assessment: ${item.status}. ${item.conclusion} [${item.evidenceId}]`).join('\n\n') : `No illustrative evidence is included for ${module.name.toLowerCase()} in this scenario.`
    return { id, title: module.name, content: `SIMULATED DEMO — fictional company, claims and evidence. No live external research has been performed.\n\n${content}${config.focus.trim() ? `\n\nRequested focus: ${config.focus.trim()}. Saved as a preference; no new research performed.` : ''}`, evidenceIds: claims.map(item => item.evidenceId), config: structuredClone(config) }
  })
}
export function initialScenarioWorkspace(scenario: DemoScenario): Workspace {
  const order: ModuleId[] = ['overview', ...new Set(scenario.claims.map(item => item.module)), 'questions']
  const workspace: Workspace = { order, configs: {}, sections: [], revisions: [], generatedAt: null }
  return { ...workspace, sections: scenarioSections(scenario, workspace) }
}
