import { BrandLogo } from './Brand'
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, ChevronDown, ChevronRight, FileCheck2, FileSpreadsheet, FileText, FolderOpen, Globe2, Layers3, Link2, Menu, Network, Quote, Search, ShieldCheck, Users, X } from 'lucide-react'
import '@fontsource-variable/manrope'
import './landing.css'
import LandingChatSample from './LandingChatSample'

const DEMO = '#/projects'
const configuredEmail = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_CONTACT_EMAIL?.trim()
const teamEmail = configuredEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail) ? configuredEmail : 'hello@ingenium.ai'
const CONTACT = `mailto:${teamEmail}?subject=${encodeURIComponent('Ingenium demo request')}`

const WORKSPACES = [
  { id: 'dashboard', label: 'Understand the numbers', icon: BarChart3, title: 'A calculation, with its working.', text: 'Select source observations, describe the analysis and review generated Python, execution evidence and data gaps.', image: '/images/workspace-dashboard-current.jpg', href: '#/project/enfuce-documents/dashboard' },
  { id: 'report', label: 'Build the bigger picture', icon: BookOpen, title: 'Your questions. Your report.', text: 'Choose from 12 diligence modules. Set topics and scope, inspect supporting quotations and preserve your revisions.', image: '/images/workspace-report-current.jpg', href: '#/project/enfuce-documents/report/build' },
  { id: 'sources', label: 'Keep the evidence close', icon: FolderOpen, title: 'One home for the whole story.', text: 'Upload documents and spreadsheets, track extraction, and inspect source records, file hashes and original-file availability.', image: '/images/workspace-sources-current.jpg', href: '#/project/enfuce-documents/data-room' },
] as const

const PERSONAS = [
  { id: 'analysts', role: 'VC Analysts & Associates', title: 'More insight. Less evidence chasing.', text: 'From company screening and market research to data room analysis and memo preparation, bring the research into a workflow you can inspect.', items: ['Find the evidence behind key metrics', 'Build a source-linked investment memo', 'Reduce repetitive checking and follow-up'], icon: Search },
  { id: 'principals', role: 'Senior Associates, VPs & Principals', title: 'Know what stands up. See what is still open.', text: 'Review diligence, challenge assumptions, and move the process forward with a clear view of the evidence behind the work.', items: ['Distinguish supported, conflicting, and missing evidence', 'Trace a finding back to its original context', 'Focus the next conversation on unresolved questions'], icon: Layers3 },
  { id: 'partners', role: 'Partners & Investment Committees', title: 'A decision you can explain. An evidence trail you can inspect.', text: 'Review the conclusions, the underlying reasoning, and the questions still on the table before making the final investment call.', items: ['Understand the basis for each material finding', 'Review and defend the reasoning behind the memo', 'Keep the final investment judgment with your team'], icon: Users },
] as const

const FAQS = [
  { question: 'What can I try in the demo?', answer: 'Open the connected Enfuce workspace to inspect document observations and quotations, select calculation inputs and configure a cited report. Results depend on compatible, reviewed inputs; missing data stays explicit. The homepage conversation is scripted.' },
  { question: 'How is Ingenium different from a general AI chat?', answer: 'Inspect the metric definition, calculation inputs and original source alongside the answer. Missing and conflicting evidence stays visible.' },
  { question: 'Does Ingenium make the investment decision?', answer: 'Your team reviews the evidence and makes the decision. Extracted claims and model-generated text require human review.' },
  { question: 'Can I upload my own documents?', answer: 'Create a company workspace to upload documents, images and spreadsheets. The data room tracks extraction and keeps original files. Connected calculations, reports and cited chat require the configured backend and providers. Live external research is not connected.' },
  { question: 'How are missing or conflicting inputs handled?', answer: 'Unknown values remain unavailable. Raw numeric context needs review before use in a calculation. Comparable disagreements retain both source values and are flagged for investigation.' },
  { question: 'What is available today, and what comes next?', answer: 'Today: evidence extraction, structured storage, source-linked agent calculations, cited chat and report review. Next: automatic catalog execution for every new project, catalog administration and version releases, and production permissions for organization-wide use.' },
] as const

function ContactSculpture() {
  // The same four facets as BrandMark, scaled into the contact illustration.
  const facets = [
    [[35, 1], [60, 18], [44, 29], [25, 16], [25, 10]],
    [[3, 36], [24, 23], [24, 52], [3, 65]],
    [[40, 37], [61, 24], [61, 53], [40, 67]],
    [[22, 61], [39, 72], [39, 85], [34, 88], [6, 70]],
  ].map(points => points.map(([x, y]) => [130 + x * 5.3, 48 + y * 5.3]))
  const coordinates = (points: number[][]) => points.map(point => point.join(',')).join(' ')

  return <div className="ig-contact-sculpture" aria-hidden="true"><svg viewBox="0 0 620 620" fill="none"><defs>
    <linearGradient id="ig-contact-front" x1="120" y1="70" x2="490" y2="570" gradientUnits="userSpaceOnUse"><stop stopColor="#cbd3ff" /><stop offset=".28" stopColor="#a2b1ff" /><stop offset=".7" stopColor="#646bda" /><stop offset="1" stopColor="#303774" /></linearGradient>
    <linearGradient id="ig-contact-side" x1="220" y1="130" x2="560" y2="530" gradientUnits="userSpaceOnUse"><stop stopColor="#5961cc" /><stop offset=".56" stopColor="#303c9a" /><stop offset="1" stopColor="#151d50" /></linearGradient>
    <linearGradient id="ig-contact-base" x1="80" y1="530" x2="530" y2="570" gradientUnits="userSpaceOnUse"><stop stopColor="#7183eb" stopOpacity="0" /><stop offset=".5" stopColor="#95a7ff" stopOpacity=".45" /><stop offset="1" stopColor="#7183eb" stopOpacity="0" /></linearGradient>
    <radialGradient id="ig-contact-light"><stop stopColor="#6272dc" stopOpacity=".17" /><stop offset="1" stopColor="#6272dc" stopOpacity="0" /></radialGradient>
    <filter id="ig-contact-blur"><feGaussianBlur stdDeviation="13" /></filter>
  </defs><ellipse cx="337" cy="338" rx="285" ry="275" fill="url(#ig-contact-light)" /><ellipse cx="316" cy="612" rx="165" ry="10" fill="#030713" fillOpacity=".5" filter="url(#ig-contact-blur)" />
    <g data-brand-plinth="layered">
      {[
        { y: 575, width: 140, fill: '#253253' },
        { y: 550, width: 125, fill: '#2e3e64' },
        { y: 525, width: 110, fill: '#3c4e7c' },
      ].map(({ y, width, fill }, index) => <g key={y} data-plinth-layer={index}>
        <path d={`M${316 - width} ${y} 316 ${y + 34} 316 ${y + 38} ${316 - width} ${y + 4}Z`} fill="#202c51" stroke="#6576b8" strokeOpacity=".4" />
        <path d={`M316 ${y + 34} ${316 + width} ${y} ${316 + width} ${y + 4} 316 ${y + 38}Z`} fill="#18223f" stroke="#6576b8" strokeOpacity=".4" />
        <path d={`M${316 - width} ${y} 316 ${y - 34} ${316 + width} ${y} 316 ${y + 34}Z`} fill={fill} stroke="#8fa5ed" strokeOpacity=".5" />
      </g>)}
    </g>
    <g data-brand-sculpture="ingenium">
      {facets.map((points, index) => <g key={index}>
        <polygon points={coordinates(points.map(([x, y]) => [x + 28, y + 18]))} fill="url(#ig-contact-side)" />
        {points.map(([x, y], edge) => {
          const [nextX, nextY] = points[(edge + 1) % points.length]
          return <polygon key={edge} points={coordinates([[x, y], [nextX, nextY], [nextX + 28, nextY + 18], [x + 28, y + 18]])} fill="url(#ig-contact-side)" />
        })}
        <polygon points={coordinates(points)} fill="url(#ig-contact-front)" />
        <polyline points={coordinates(points.slice(0, 3))} stroke="#d5ddff" strokeOpacity=".48" strokeWidth="1" />
      </g>)}
    </g>
    <path d="M93 616h447" stroke="url(#ig-contact-base)" strokeWidth="2" />
  </svg></div>
}

function EvidenceIntake() {
  return <section className="ig-semantics ig-container" id="metric-catalog" aria-labelledby="ig-semantics-title">
    <div className="ig-section-heading"><div><p className="ig-eyebrow">How it works</p><h2 id="ig-semantics-title">Start with the evidence.</h2></div><p>From company documents to a defined calculation question.</p></div>
    <div className="ig-semantic-flow" id="workflow">
      <article><FolderOpen size={25} aria-hidden="true" /><h3>Create a project</h3><p>Open a company workspace and upload documents or spreadsheets.</p></article>
      <article><FileCheck2 size={25} aria-hidden="true" /><h3>Review the evidence</h3><p>Inspect extracted numbers and quotations with their sources, periods and units.</p></article>
      <article><BarChart3 size={25} aria-hidden="true" /><h3>Define the calculation</h3><p>Select source inputs, review their numeric context and describe what to calculate.</p></article>
    </div>
  </section>
}

function EvidenceExample() {
  const [step, setStep] = useState('inputs')
  const examples = {
    inputs: { label: 'Recorded execution', title: 'Inspect how the result was produced.', text: 'The backend generates and runs Python from your question and selected inputs. Review the saved code, source bindings, assumptions and execution evidence with the result.', locator: 'Dashboard → Calculation workspace · code and execution record', icon: Network, href: '#/project/enfuce-documents/dashboard', action: 'Open the calculation workspace' },
    execution: { label: 'Evidence and limitations', title: 'Know what the evidence supports.', text: 'Missing identifies absent inputs. Verify marks evidence that needs review. Conflict flags comparable numeric disagreements. Review coverage and assumptions before using a result.', locator: 'Dashboard → Evidence gaps / source values / period coverage', icon: FileCheck2, href: '#/project/enfuce-documents/dashboard', action: 'Inspect evidence coverage' },
    report: { label: 'Source-backed report', title: 'Carry the evidence into the investment memo.', text: 'Choose from 12 report modules, set topics and scope, then review the draft alongside its supporting quotations. Preserve human edits and unresolved questions before exporting.', locator: 'Report → Build / Review / Export · quotations and gaps', icon: BookOpen, href: '#/project/enfuce-documents/report/build', action: 'Explore Report Builder' },
  }
  const current = examples[step as keyof typeof examples]
  return <div className="ig-evidence-example"><div className="ig-evidence-tabs" role="tablist" aria-label="Explore the connected product workflow">{[['inputs', 'Inspect execution'], ['execution', 'Review evidence'], ['report', 'Build the report']].map(([id, label], i) => <button key={id} id={`ig-evidence-tab-${id}`} role="tab" aria-selected={step === id} aria-controls="ig-evidence-panel" tabIndex={step === id ? 0 : -1} onClick={() => setStep(id)} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const ids = ['inputs', 'execution', 'report']; const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3; setStep(ids[next]); document.getElementById(`ig-evidence-tab-${ids[next]}`)?.focus() } }}><span>{i + 1}</span>{label}<ChevronRight size={15} /></button>)}</div><div className="ig-evidence-panel" id="ig-evidence-panel" role="tabpanel" aria-labelledby={`ig-evidence-tab-${step}`} tabIndex={0}><div className="ig-evidence-panel-heading"><current.icon size={22} /><span>{current.label}</span><span className="ig-sample-tag">Workflow overview</span></div><h3>{current.title}</h3><p>{current.text}</p><div className="ig-evidence-locator"><Link2 size={15} /><span>{current.locator}</span></div><a href={current.href}>{current.action} <ArrowUpRight size={16} /></a></div></div>
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [workspace, setWorkspace] = useState(0)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const selectedWorkspace = WORKSPACES[workspace]
  const goToTop = () => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })

  useEffect(() => {
    if (menuOpen) document.querySelector<HTMLAnchorElement>('.ig-navigation a')?.focus()
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && menuOpen) {
        setMenuOpen(false)
        document.querySelector<HTMLButtonElement>('.ig-mobile-menu')?.focus()
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [menuOpen])

  useEffect(() => {
    const onHashChange = () => {
      setMenuOpen(false)
      const id = window.location.hash.slice(1)
      if (id && !id.startsWith('/')) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }))
    }
    window.addEventListener('hashchange', onHashChange)
    onHashChange()
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return <div className="ingenium-site">
    <a className="ig-skip" href="#ig-main">Skip to content</a>
    <header className="ig-header"><div className="ig-nav-wrap"><a className="ig-wordmark" href="#/" onClick={goToTop} aria-label="Ingenium home"><BrandLogo /></a><nav className={`ig-navigation ${menuOpen ? 'is-open' : ''}`} aria-label="Website navigation" onClick={() => setMenuOpen(false)}><a href="#product">Product</a><a href="#why-trust">Why Ingenium</a><a href="#metric-catalog">How it works</a><a href="#teams">Who it’s for</a><a href="#contact">Contact</a></nav><div className="ig-header-actions"><a className="ig-nav-login" href={DEMO}>See the Platform <ArrowUpRight size={13} /></a><a className="ig-button ig-button-light ig-nav-demo" href={DEMO}>Open workspace <ArrowUpRight size={14} /></a><button className="ig-mobile-menu" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={23} /> : <Menu size={23} />}</button></div></div></header>
    <main id="ig-main" tabIndex={-1}>
      <section className="ig-hero ig-container"><div className="ig-hero-copy"><div className="ig-intro"><span /> An evidence-first data agent for investment teams</div><h1>Trusted diligence,<br />powered by the<br /><span>world’s evidence.</span></h1><p>Turn company documents into source-linked analysis. Choose the evidence, ask a calculation question, inspect the generated Python and build a cited diligence report.</p><div className="ig-hero-actions"><a className="ig-button ig-button-light" href={DEMO}>Open workspace <ArrowUpRight size={17} /></a><a className="ig-button ig-button-outline" href={DEMO}>See the Platform <ArrowUpRight size={17} /></a></div><div className="ig-hero-footnote"><ShieldCheck size={14} /><span>Evidence informs the work. The judgment stays yours.</span></div></div><div className="ig-hero-demo"><LandingChatSample /></div><a className="ig-scroll-cue" href="#why-ingenium"><span>Follow the evidence</span><ArrowDown size={15} /></a></section>
      <section className="ig-problem ig-container" id="why-ingenium"><div className="ig-section-intro"><p className="ig-eyebrow">The diligence gap</p><h2>Investment decisions are only as strong<br />as the evidence behind them.</h2><p>Every deal brings different files, periods and definitions. Analysts spend time reconciling numbers and rebuilding the same metric logic.</p></div><div className="ig-problem-grid"><article><div className="ig-fragment-visual"><span className="ig-fragment ig-fragment-one"><FileText size={22} />Pitch deck</span><span className="ig-fragment ig-fragment-two"><FileSpreadsheet size={22} />Financials</span><span className="ig-fragment ig-fragment-three"><Globe2 size={22} />Research</span></div><h3>Fragmented data</h3><p>Critical information lives across too many files, tools, and sources.</p></article><article><div className="ig-number-visual"><span>Reported metric</span><strong>Actual? <Search size={23} /></strong><small>Which period? Which scope?</small><div className="ig-question-line" /></div><h3>Hard-to-verify claims</h3><p>Numbers often arrive without their definition, assumptions or original location.</p></article><article><div className="ig-memo-visual"><Quote size={21} /><span /><span /><span /><div><span /> Evidence still missing</div></div><h3>Hidden contradictions</h3><p>Different sources can tell different stories. The gaps need to stay visible.</p></article></div></section>

      <EvidenceIntake />

      <section className="ig-product" id="product"><div className="ig-container"><div className="ig-section-heading"><div><p className="ig-eyebrow">Meet Ingenium</p><h2>The whole picture.<br />With the evidence attached.</h2></div><p>Inspect metrics, manage sources and build cited reports in three connected workspaces.</p></div><div className="ig-workspace-tabs" role="tablist" aria-label="Explore the Ingenium workspaces">{WORKSPACES.map((item, index) => <button key={item.id} id={`ig-workspace-tab-${index}`} role="tab" aria-selected={workspace === index} aria-controls="ig-workspace-panel" tabIndex={workspace === index ? 0 : -1} onClick={() => setWorkspace(index)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3; setWorkspace(next); document.getElementById(`ig-workspace-tab-${next}`)?.focus() } }}><item.icon size={19} /><span>{item.label}</span></button>)}</div><div className="ig-product-preview" id="ig-workspace-panel" role="tabpanel" aria-labelledby={`ig-workspace-tab-${workspace}`}><div className="ig-browser-bar"><div><i /><i /><i /></div><span><ShieldCheck size={11} /> Ingenium workspace</span><a href={selectedWorkspace.href} aria-label={`Open ${selectedWorkspace.label} demo`}><ArrowUpRight size={15} /></a></div><a className="ig-product-image-link" href={selectedWorkspace.href} aria-label={`Explore the ${selectedWorkspace.id} workspace`}><img key={selectedWorkspace.image} src={selectedWorkspace.image} alt={`Ingenium ${selectedWorkspace.id} workspace showing historical Enfuce evidence`} width="1440" height="1000" loading="lazy" /></a></div><div className="ig-preview-description"><div><h3>{selectedWorkspace.title}</h3><p>{selectedWorkspace.text}</p></div><a className="ig-text-link" href={selectedWorkspace.href}>Explore this workspace <ArrowUpRight size={17} /></a></div><p className="ig-preview-caption">Historical demo interface previews · Links open the connected Enfuce workspace</p>
</div></section>



      <section className="ig-proof-section" id="why-trust"><div className="ig-container"><div className="ig-section-heading"><div><p className="ig-eyebrow">Inside the connected workspace</p><h2>From source evidence<br />to investment analysis.</h2></div><p>Control the inputs. Inspect the execution. Keep the evidence with the report.</p></div><EvidenceExample /></div></section>



      <section className="ig-teams ig-container" id="teams"><div className="ig-section-intro"><p className="ig-eyebrow">Who we serve</p><h2>Built for professional investment teams.</h2><p>From the first company screen to the final investment committee discussion.</p></div><div className="ig-persona-grid">{PERSONAS.map(item => <article className="ig-persona-card" key={item.id}><div className="ig-persona-role"><item.icon size={21} /><h3>{item.role}</h3></div><h4>{item.title}</h4><p>{item.text}</p><ul>{item.items.map(benefit => <li key={benefit}><Check size={16} />{benefit}</li>)}</ul><a className="ig-text-link" href={DEMO}>Find your workflow <ArrowUpRight size={16} /></a></article>)}</div></section>

      <section className="ig-plans" id="plans"><div className="ig-container">
        <div className="ig-section-heading"><div><p className="ig-eyebrow">Business model</p><h2>Built for teams.<br />Priced for scale.</h2></div><p>A B2B SaaS subscription model based on team size, diligence volume, and enterprise requirements.</p></div>
        <div className="ig-plan-grid">{[
          { name: 'Team', for: 'For smaller VC and investment teams.', items: ['A focused diligence workspace', 'Source-linked research and reports', 'A structure that grows with your team'] },
          { name: 'Professional', for: 'For institutional VC, growth equity, and private equity teams.', items: ['Higher diligence volume', 'Repeatable research and review workflows', 'Reporting shaped around your process'] },
          { name: 'Enterprise', for: 'For larger investment organizations.', items: ['Discuss security and permission requirements', 'Explore integrations and firm-wide knowledge', 'Define organization-wide deployment needs'] },
        ].map(plan => <article key={plan.name}><h3>{plan.name}</h3><p>{plan.for}</p><span>Let’s find the right fit.</span><ul>{plan.items.map(item => <li key={item}><Check size={14} />{item}</li>)}</ul><a href={`mailto:${teamEmail}?subject=${encodeURIComponent('Ingenium ' + plan.name + ' pricing inquiry')}`}>Contact us for pricing <ArrowUpRight size={15} /></a></article>)}</div>
        <p className="ig-plan-note">Contact us to discuss scope, availability, and pricing. Plan details and enterprise capabilities are agreed with your team.</p>
      </div></section>

      <section className="ig-faq ig-container"><div><p className="ig-eyebrow">A few things worth knowing</p><h2>A closer look.</h2><p>Start exploring.<br />The evidence is there to inspect.</p></div><div className="ig-faq-list">{FAQS.map((item, index) => <div className={`ig-faq-item ${openFaq === index ? 'is-open' : ''}`} key={item.question}><h3><button aria-expanded={openFaq === index} aria-controls={`ig-faq-answer-${index}`} onClick={() => setOpenFaq(openFaq === index ? null : index)}>{item.question}<ChevronDown size={18} /></button></h3><div id={`ig-faq-answer-${index}`} hidden={openFaq !== index}><p>{item.answer}</p></div></div>)}</div></section>

      <section className="ig-contact" id="contact"><div className="ig-container"><div className="ig-contact-copy"><p className="ig-eyebrow">See Ingenium in action</p><h2>Build conviction<br />on evidence.</h2><p>Explore the workspace or contact us to discuss your team’s diligence needs.</p><div className="ig-contact-actions"><a className="ig-button ig-button-light" href={DEMO}>Open workspace <ArrowUpRight size={18} /></a><a className="ig-button ig-button-outline" href={CONTACT} target={teamEmail ? undefined : '_blank'} rel={teamEmail ? undefined : 'noopener noreferrer'}>Contact the team <ArrowUpRight size={17} /></a></div><p className="ig-contact-note"><a href={`mailto:${teamEmail}`}>{teamEmail}</a></p></div><div className="ig-contact-orbit" aria-hidden="true"><div className="ig-contact-ring" /><div className="ig-contact-ring" /><div className="ig-contact-ring" /><ContactSculpture /></div></div></section>
    </main>
    <footer className="ig-footer ig-container"><div className="ig-footer-top"><div><a className="ig-wordmark" href="#/" onClick={goToTop} aria-label="Ingenium home"><BrandLogo /></a><p>Trusted diligence,<br />powered by the world’s evidence.</p></div><div className="ig-footer-links"><div><strong>Explore</strong><a href="#product">The platform</a><a href="#workflow">How it works</a><a href="#teams">Who it’s for</a><a href="#plans">Plans</a></div><div><strong>Get closer</strong><a href={DEMO}>See the Platform <ArrowUpRight size={12} /></a><a href={CONTACT} target={teamEmail ? undefined : '_blank'} rel="noopener noreferrer">Contact the team</a><a href="https://github.com/imnotmomo/acefire" target="_blank" rel="noopener noreferrer">Project on GitHub <ArrowUpRight size={12} /></a></div></div></div><p className="ig-technology-note">Akta: company source records (live retrieval unavailable). PRISM: system map. Nicrron: backend model API.</p><div className="ig-footer-bottom"><span>© {new Date().getFullYear()} Ingenium</span><span>Built for evidence. Designed for judgment.</span><a href="#/" onClick={goToTop}>Back to top <ArrowRight size={13} /></a></div></footer>
  </div>
}
