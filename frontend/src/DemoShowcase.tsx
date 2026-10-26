import { useState } from 'react'
import { Badge, Dialog, Icon } from './ui'
import './demo-showcase.css'

const scenarios = [
  {
    name: 'HealthTech / Biotech', image: 'claims.jpg', alt: 'Clinician reviewing medical imaging', value: 'Claims',
    title: 'Internal claims. External evidence.', question: 'Can we trust the claims?',
    description: 'An AI diagnostics company raising Series A/B funding.',
    path: ['Company claim', 'Internal evidence', 'External evidence', 'Verified / Unsupported / Contradicted'],
    rows: [
      ['Clinical accuracy reaches 94%', 'Clinical study materials and validation protocol', 'ClinicalTrials.gov and PubMed; compare patient populations and study design'],
      ['The market exceeds $10B', 'Company market-sizing assumptions', 'Market research and competing products; compare scope and date'],
      ['Multiple hospital pilots completed', 'Pilot records and partner agreements', 'Hospital partnership announcements; distinguish pilots from paid deployments'],
      ['A clear FDA pathway', 'Regulatory strategy and agency correspondence', 'FDA records; distinguish proposed pathways from product clearance'],
    ],
  },
  {
    name: 'Consumer / Marketplace', image: 'narrative.jpg', alt: 'Customer paying by card at a retail counter', value: 'Narrative',
    title: 'Narrative vs Reality', question: 'Can we trust the investment story?',
    description: 'A fast-growing consumer marketplace seeking investment.',
    path: ['Founder narrative', 'Financial data', 'User metrics', 'External market evidence', 'Investment risk'],
    rows: [
      ['GMV grew 150%', 'Revenue growth may depend on discounts and subsidies', 'Separate reported GMV from net revenue and contribution margin'],
      ['Users are growing rapidly', 'MAU and paying-user growth may diverge', 'Compare retention and paid conversion with App Store and Reddit signals'],
      ['Unit economics are improving', 'CAC may be increasing', 'Check acquisition costs, subsidies and retention for comparable cohorts'],
      ['Clear market leadership', 'Market-size references may be outdated', 'Compare current research and Similarweb signals with the company narrative'],
    ],
  },
]

export default function DemoShowcase() {
  const [selected, setSelected] = useState<number | null>(null)
  const scenario = selected === null ? null : scenarios[selected]
  return <section className="ui-demo-showcase" aria-label="Explore three diligence demos">
    <div className="ui-demo-heading"><h2>Explore Ingenium</h2><p>Numbers. Claims. Narrative.</p></div>
    <div className="ui-demo-grid">
      <article className="ui-demo-card">
        <a href="#/project/enfuce-documents/dashboard" aria-label="Open Enfuce company workspace"><img src="/images/projects/numbers.jpg" alt="Laptop displaying financial analytics" /></a>
        <div><Badge>Numbers</Badge><h3>Enfuce</h3><strong>Can we trust the numbers?</strong><p>Explore the existing company workspace, stored reports and source-linked evidence.</p><a className="button secondary" href="#/project/enfuce-documents/dashboard">Open company workspace<Icon name="outward" size={15} /></a></div>
      </article>
      {scenarios.map((item, index) => <article className="ui-demo-card" key={item.name}>
        <button className="ui-demo-cover" onClick={() => setSelected(index)} aria-label={`Explore ${item.name}`}><img src={`/images/projects/${item.image}`} alt={item.alt} /></button>
        <div><Badge tone="purple">{item.value}</Badge><h3>{item.name}</h3><strong>{item.question}</strong><p>{item.title}</p><button className="button secondary" onClick={() => setSelected(index)}>Explore scenario<Icon name="outward" size={15} /></button></div>
      </article>)}
    </div>
    {scenario && <Dialog title={scenario.name} subtitle={scenario.title} onClose={() => setSelected(null)}>
      <div className="dialog-body ui-demo-detail"><Badge tone="purple">Illustrative scenario</Badge><p>{scenario.description}</p><p>These are example diligence questions, not findings about an actual company. No external verification has been performed.</p>
        <ol className="ui-demo-path">{scenario.path.map(step => <li key={step}>{step}</li>)}</ol>
        {scenario.rows.map(([claim, internal, external]) => <article key={claim}><h3>{claim}</h3><dl><dt>{selected === 0 ? 'Internal evidence to inspect' : 'Risk to investigate'}</dt><dd>{internal}</dd><dt>{selected === 0 ? 'External cross-check' : 'Evidence to compare'}</dt><dd>{external}</dd></dl></article>)}
      </div>
    </Dialog>}
  </section>
}
