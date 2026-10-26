import { BrandLogo, BrandMark } from './Brand'
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, BarChart3, BookOpen, Check, ChevronDown, ChevronRight, FileCheck2, FileSpreadsheet, FileText, FolderOpen, Globe2, Layers3, Link2, Menu, Network, Quote, Search, ShieldCheck, Users, X } from 'lucide-react'
import '@fontsource-variable/manrope'
import './landing.css'

const DEMO = '#/projects'
const configuredEmail = (import.meta as ImportMeta & { env: Record<string, string | undefined> }).env.VITE_CONTACT_EMAIL?.trim()
const teamEmail = configuredEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredEmail) ? configuredEmail : 'hello@ingenium.ai'
const CONTACT = `mailto:${teamEmail}?subject=${encodeURIComponent('Ingenium demo request')}`

const WORKSPACES = [
  { id: 'dashboard', label: 'Understand the numbers', icon: BarChart3, title: 'The number is just the beginning.', text: 'See the metric, its definition, and the inputs behind it. Follow the calculation all the way back to the source.', image: '/images/workspace-dashboard-current.jpg', href: '#/project/enfuce/dashboard' },
  { id: 'report', label: 'Build the bigger picture', icon: BookOpen, title: 'Your questions. Your report.', text: 'Choose the modules that matter, set the focus, and review each section alongside its evidence. Keep your own judgment in the loop.', image: '/images/workspace-report-current.jpg', href: '#/project/enfuce/report/build' },
  { id: 'sources', label: 'Keep the evidence close', icon: FolderOpen, title: 'One home for the whole story.', text: 'Keep documents, financial records, and source references in view. A useful answer should always come with somewhere to look.', image: '/images/workspace-sources-current.jpg', href: '#/project/enfuce/data-room' },
] as const

const PERSONAS = [
  { id: 'analysts', role: 'VC Analysts & Associates', title: 'More insight. Less evidence chasing.', text: 'From company screening and market research to data room analysis and memo preparation, bring the research into a workflow you can inspect.', items: ['Find the evidence behind key metrics', 'Build a source-linked investment memo', 'Reduce repetitive checking and follow-up'], icon: Search },
  { id: 'principals', role: 'Senior Associates, VPs & Principals', title: 'Know what stands up. See what is still open.', text: 'Review diligence, challenge assumptions, and move the process forward with a clear view of the evidence behind the work.', items: ['Distinguish supported, conflicting, and missing evidence', 'Trace a finding back to its original context', 'Focus the next conversation on unresolved questions'], icon: Layers3 },
  { id: 'partners', role: 'Partners & Investment Committees', title: 'A decision you can explain. An evidence trail you can inspect.', text: 'Review the conclusions, the underlying reasoning, and the questions still on the table before making the final investment call.', items: ['Understand the basis for each material finding', 'Review and defend the reasoning behind the memo', 'Keep the final investment judgment with your team'], icon: Users },
] as const

const FAQS = [
  { question: 'What can I try in the demo?', answer: 'You can explore projects, inspect financial evidence and calculations, customize a report, make revisions, and export a document. Enfuce uses a historical evidence snapshot, so you can explore it without connecting your own sources. Circle also has a stored-data view when the prepared company-data backend is running.' },
  { question: 'How is Ingenium different from a general AI chat?', answer: 'The workspace keeps the source, the number, the calculation, and the written report connected. It gives your team a place to inspect definitions, review missing evidence, and record human revisions rather than relying on an answer alone.' },
  { question: 'Does Ingenium make the investment decision?', answer: 'No. Ingenium is designed to support diligence with structured evidence and visible open questions. Your team decides how to interpret the findings and what action to take.' },
  { question: 'Can I upload my own documents?', answer: 'The local workspace can save and preview files in your browser. New-document extraction, external research, and open-ended AI chat are still being connected. The current demo does not promise automatic analysis of new uploads.' },
] as const


function EvidenceSculpture() {
  // The same four facets as BrandMark, scaled into the existing hero scene.
  const facets = [
    [[35, 1], [60, 18], [44, 29], [25, 16], [25, 10]],
    [[3, 36], [24, 23], [24, 52], [3, 65]],
    [[40, 37], [61, 24], [61, 53], [40, 67]],
    [[22, 61], [39, 72], [39, 85], [34, 88], [6, 70]],
  ].map(points => points.map(([x, y]) => [130 + x * 5.3, 48 + y * 5.3]))
  const coordinates = (points: number[][]) => points.map(point => point.join(',')).join(' ')

  return <div className="ig-sculpture" aria-hidden="true"><svg viewBox="0 0 620 620" fill="none"><defs>
    <linearGradient id="ig-front" x1="120" y1="70" x2="490" y2="570" gradientUnits="userSpaceOnUse"><stop stopColor="#cbd3ff" /><stop offset=".28" stopColor="#a2b1ff" /><stop offset=".7" stopColor="#646bda" /><stop offset="1" stopColor="#303774" /></linearGradient>
    <linearGradient id="ig-side" x1="220" y1="130" x2="560" y2="530" gradientUnits="userSpaceOnUse"><stop stopColor="#5961cc" /><stop offset=".56" stopColor="#303c9a" /><stop offset="1" stopColor="#151d50" /></linearGradient>
    <linearGradient id="ig-base" x1="80" y1="530" x2="530" y2="570" gradientUnits="userSpaceOnUse"><stop stopColor="#7183eb" stopOpacity="0" /><stop offset=".5" stopColor="#95a7ff" stopOpacity=".45" /><stop offset="1" stopColor="#7183eb" stopOpacity="0" /></linearGradient>
    <radialGradient id="ig-light"><stop stopColor="#6272dc" stopOpacity=".17" /><stop offset="1" stopColor="#6272dc" stopOpacity="0" /></radialGradient>
    <filter id="ig-blur"><feGaussianBlur stdDeviation="13" /></filter>
  </defs><ellipse cx="337" cy="338" rx="285" ry="275" fill="url(#ig-light)" /><ellipse cx="330" cy="548" rx="210" ry="20" fill="#030713" fillOpacity=".6" filter="url(#ig-blur)" />
    <g data-brand-sculpture="ingenium">
      {facets.map((points, index) => <g key={index}>
        <polygon points={coordinates(points.map(([x, y]) => [x + 28, y + 18]))} fill="url(#ig-side)" />
        {points.map(([x, y], edge) => {
          const [nextX, nextY] = points[(edge + 1) % points.length]
          return <polygon key={edge} points={coordinates([[x, y], [nextX, nextY], [nextX + 28, nextY + 18], [x + 28, y + 18]])} fill="url(#ig-side)" />
        })}
        <polygon points={coordinates(points)} fill="url(#ig-front)" />
        <polyline points={coordinates(points.slice(0, 3))} stroke="#d5ddff" strokeOpacity=".48" strokeWidth="1" />
      </g>)}
    </g>
    <path d="m206 548 110-34 110 34-110 35-110-35Z" fill="#19203c" stroke="#6576b8" strokeOpacity=".4" />
    <path d="m240 548 76-23 76 23-76 24-76-24Z" fill="#334475" fillOpacity=".45" stroke="#8fa5ed" strokeOpacity=".4" />
    <path d="M93 584h447" stroke="url(#ig-base)" strokeWidth="2" />
    <g className="ig-sculpture-annotations">
      <path d="M452 244h24l16 16M465 340h27M396 457h65l31-31" stroke="#aab8ff" strokeOpacity=".38" strokeWidth="1" />
      {[{ label: 'Data', y: 260 }, { label: 'Reasoning', y: 340 }, { label: 'Evidence', y: 426 }].map(({ label, y }) => <g key={label}>
        <circle cx="492" cy={y} r="3" fill="#bbc6ff" />
        <circle cx="492" cy={y} r="7" stroke="#bbc6ff" strokeOpacity=".2" />
        <text x="508" y={y + 5} fill="#c7d0ed" fontSize="15" fontWeight="400" letterSpacing=".2">{label}</text>
      </g>)}
    </g>
  </svg></div>
}

function EvidenceExample() {
  const [step, setStep] = useState('claim')
  const examples = {
    claim: { label: 'A number worth understanding', title: '€3,452,682.81', text: 'H1 2020 operating income, as recorded in the saved group worksheet.', locator: 'June 2020 Financials.xlsx / P&L - Group!I6', icon: FileCheck2 },
    formula: { label: 'The calculation behind it', title: 'Revenue + other income', text: '€3,417,663.76 + €35,019.05 = €3,452,682.81. The saved inputs reproduce the total.', locator: 'P&L - Group!C4:H5 → I6', icon: Network },
    source: { label: 'The context that matters', title: 'Definitions deserve a closer look.', text: 'The summary labels the total as revenue. Confirm whether that definition should include other operating income before comparing figures.', locator: 'Five-year financial summary!F4 (English worksheet label) / P&L - Group!B4:I6', icon: FileSpreadsheet },
  }
  const current = examples[step as keyof typeof examples]
  return <div className="ig-evidence-example"><div className="ig-evidence-tabs" role="tablist" aria-label="Explore a source-linked example">{[['claim', 'The claim'], ['formula', 'The calculation'], ['source', 'The source']].map(([id, label], i) => <button key={id} id={`ig-evidence-tab-${id}`} role="tab" aria-selected={step === id} aria-controls="ig-evidence-panel" tabIndex={step === id ? 0 : -1} onClick={() => setStep(id)} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const ids = ['claim', 'formula', 'source']; const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3; setStep(ids[next]); document.getElementById(`ig-evidence-tab-${ids[next]}`)?.focus() } }}><span>{i + 1}</span>{label}<ChevronRight size={15} /></button>)}</div><div className="ig-evidence-panel" id="ig-evidence-panel" role="tabpanel" aria-labelledby={`ig-evidence-tab-${step}`} tabIndex={0}><div className="ig-evidence-panel-heading"><current.icon size={22} /><span>{current.label}</span><span className="ig-sample-tag">Historical example</span></div><h3>{current.title}</h3><p>{current.text}</p><div className="ig-evidence-locator"><Link2 size={15} /><span>{current.locator}</span></div><a href="#/project/enfuce/dashboard">Follow the evidence in the demo <ArrowUpRight size={16} /></a></div></div>
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
    <header className="ig-header"><div className="ig-nav-wrap"><a className="ig-wordmark" href="#/" onClick={goToTop} aria-label="Ingenium home"><BrandLogo /></a><nav className={`ig-navigation ${menuOpen ? 'is-open' : ''}`} aria-label="Website navigation" onClick={() => setMenuOpen(false)}><a href="#product">Product</a><a href="#why-trust">Why Ingenium</a><a href="#workflow">How it works</a><a href="#teams">Who it’s for</a><a href="#contact">Contact</a></nav><div className="ig-header-actions"><a className="ig-nav-login" href={DEMO}>See the Platform <ArrowUpRight size={13} /></a><a className="ig-button ig-button-light ig-nav-demo" href={DEMO}>Book a Demo <ArrowUpRight size={14} /></a><button className="ig-mobile-menu" aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={23} /> : <Menu size={23} />}</button></div></div></header>
    <main id="ig-main" tabIndex={-1}>
      <section className="ig-hero ig-container"><div className="ig-hero-copy"><div className="ig-intro"><span /> An evidence-first workspace for investment teams</div><h1>Trusted diligence,<br />powered by the<br /><span>world’s evidence.</span></h1><p>Ingenium helps investment teams turn fragmented information into verifiable insights by tracing every number, claim, and conclusion back to its source.</p><div className="ig-hero-actions"><a className="ig-button ig-button-light" href={DEMO}>Book a Demo <ArrowUpRight size={17} /></a><a className="ig-button ig-button-outline" href={DEMO}>See the Platform <ArrowUpRight size={17} /></a></div><div className="ig-hero-footnote"><ShieldCheck size={14} /><span>Evidence informs the work. The judgment stays yours.</span></div></div><EvidenceSculpture /><a className="ig-scroll-cue" href="#why-ingenium"><span>Follow the evidence</span><ArrowDown size={15} /></a></section>
      <div className="ig-principles-strip"><div className="ig-container"><span>One connected diligence workflow</span><span><FileText size={17} /> Source-led research</span><span><Network size={17} /> Traceable numbers</span><span><BookOpen size={17} /> Reports you shape</span><span><Users size={17} /> Human judgment</span></div></div>

      <section className="ig-problem ig-container" id="why-ingenium"><div className="ig-section-intro"><p className="ig-eyebrow">The diligence gap</p><h2>Investment decisions are only as strong<br />as the evidence behind them.</h2><p>Diligence spans financial models, pitch decks, data rooms, management calls, and external research. Too much time goes into verifying numbers, reconciling conflicting information, and rebuilding the evidence behind a decision.</p></div><div className="ig-problem-grid"><article><div className="ig-fragment-visual"><span className="ig-fragment ig-fragment-one"><FileText size={22} />Pitch deck</span><span className="ig-fragment ig-fragment-two"><FileSpreadsheet size={22} />Financials</span><span className="ig-fragment ig-fragment-three"><Globe2 size={22} />Research</span></div><h3>Fragmented data</h3><p>Critical information lives across too many files, tools, and sources.</p></article><article><div className="ig-number-visual"><span>Reported revenue</span><strong>€3.45m <Search size={23} /></strong><small>Which definition? Which source?</small><div className="ig-question-line" /></div><h3>Hard-to-verify claims</h3><p>Where did this number come from? Which assumptions support it? The path from claim to source is too often unclear.</p></article><article><div className="ig-memo-visual"><Quote size={21} /><span /><span /><span /><div><span /> Evidence still missing</div></div><h3>Hidden contradictions</h3><p>Conflicting metrics and statements are easy to miss when the diligence process moves quickly.</p></article></div></section>

      <section className="ig-teams ig-container" id="teams"><div className="ig-section-intro"><p className="ig-eyebrow">Who we serve</p><h2>Built for professional investment teams.</h2><p>From the first company screen to the final investment committee discussion.</p></div><div className="ig-persona-grid">{PERSONAS.map(item => <article className="ig-persona-card" key={item.id}><div className="ig-persona-role"><item.icon size={21} /><h3>{item.role}</h3></div><h4>{item.title}</h4><p>{item.text}</p><ul>{item.items.map(benefit => <li key={benefit}><Check size={16} />{benefit}</li>)}</ul><a className="ig-text-link" href={DEMO}>Find your workflow <ArrowUpRight size={16} /></a></article>)}</div></section>

      <section className="ig-workflow ig-container" id="workflow"><div className="ig-section-intro"><p className="ig-eyebrow">How Ingenium works</p><h2>From fragmented information<br />to investment conviction.</h2><p>Start with the sources. Ask the right questions.<br />Keep the evidence with you, all the way to the report.</p></div><div className="ig-workflow-grid">{[
        { num: '01', icon: FolderOpen, title: 'Ingest', text: 'Bring financials, pitch decks, notes, data room files, and external research into one project.', detail: 'Gather the context' },
        { num: '02', icon: Network, title: 'Trace', text: 'Connect each metric, claim, and finding to its source. Follow the inputs and reasoning behind the number.', detail: 'Follow the source' },
        { num: '03', icon: FileCheck2, title: 'Verify', text: 'Bring conflicting figures, unsupported assumptions, and missing evidence into view for review.', detail: 'Understand what holds up' },
        { num: '04', icon: BookOpen, title: 'Decide', text: 'Turn reviewed insights into structured diligence reports and investment memos. Your team makes the call.', detail: 'Build / Review / Export' },
      ].map(item => <article key={item.num}><div className="ig-workflow-number"><span>{item.num}</span><item.icon size={24} /></div><h3>{item.title}</h3><p>{item.text}</p><small>{item.detail}</small></article>)}</div><div className="ig-workflow-chat"><span><Search size={18} /></span><p>And when a question comes up?<strong>Ask it in the context of the work.</strong></p><a href="#/project/enfuce/report/build">Meet the workspace <ArrowUpRight size={17} /></a></div></section>

      <section className="ig-capabilities ig-container" id="capabilities">
        <div className="ig-section-intro"><p className="ig-eyebrow">Core capabilities</p><h2>Every conclusion should<br />be explainable.</h2><p>Keep the claim, the calculation, and the source connected.</p></div>
        <div className="ig-capabilities-grid">
          <article className="ig-lineage-feature"><Network size={26} /><h3>Evidence lineage</h3><p>See where each number, claim, and insight comes from, with the source context close at hand.</p><div className="ig-mini-lineage" aria-hidden="true"><span><FileSpreadsheet size={18} />Original source<small>File / sheet / cell</small></span><ArrowDown size={19} /><span><Network size={18} />Financial reasoning<small>Inputs / formula / definition</small></span><ArrowDown size={19} /><span><FileCheck2 size={18} />Reviewable finding<small>Evidence and limitations attached</small></span></div></article>
          {[
            { icon: Search, title: 'Contradiction detection', text: 'Bring numerical disagreements and conflicting source claims into view, with the context needed to investigate.' },
            { icon: Layers3, title: 'Evidence coverage', text: 'Understand which material claims have support, where sources disagree, and what is still incomplete.' },
            { icon: BarChart3, title: 'Financial traceability', text: 'Follow key metrics back to financial models, original documents, and recorded calculation logic.' },
            { icon: BookOpen, title: 'Investment-ready reporting', text: 'Build structured diligence reports and memos with source references and room for human review.' },
          ].map(item => <article key={item.title}><item.icon size={23} /><h3>{item.title}</h3><p>{item.text}</p></article>)}
        </div>
        <p className="ig-capability-note">The working demo includes source-linked financial evidence and report review. Automated ingestion and broader document checks are still being developed.</p>
      </section>

      <section className="ig-product" id="product"><div className="ig-container"><div className="ig-section-heading"><div><p className="ig-eyebrow">Meet Ingenium</p><h2>The whole picture.<br />With the evidence attached.</h2></div><p>Three connected workspaces.<br />One clear line from source to understanding.</p></div><div className="ig-workspace-tabs" role="tablist" aria-label="Explore the Ingenium workspaces">{WORKSPACES.map((item, index) => <button key={item.id} id={`ig-workspace-tab-${index}`} role="tab" aria-selected={workspace === index} aria-controls="ig-workspace-panel" tabIndex={workspace === index ? 0 : -1} onClick={() => setWorkspace(index)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3; setWorkspace(next); document.getElementById(`ig-workspace-tab-${next}`)?.focus() } }}><item.icon size={19} /><span>{item.label}</span></button>)}</div><div className="ig-product-preview" id="ig-workspace-panel" role="tabpanel" aria-labelledby={`ig-workspace-tab-${workspace}`}><div className="ig-browser-bar"><div><i /><i /><i /></div><span><ShieldCheck size={11} /> Ingenium workspace</span><a href={selectedWorkspace.href} aria-label={`Open ${selectedWorkspace.label} demo`}><ArrowUpRight size={15} /></a></div><a className="ig-product-image-link" href={selectedWorkspace.href} aria-label={`Explore the ${selectedWorkspace.id} workspace`}><img key={selectedWorkspace.image} src={selectedWorkspace.image} alt={`Ingenium ${selectedWorkspace.id} workspace showing historical Enfuce evidence`} width="1440" height="1000" loading="lazy" /></a></div><div className="ig-preview-description"><div><h3>{selectedWorkspace.title}</h3><p>{selectedWorkspace.text}</p></div><a className="ig-text-link" href={selectedWorkspace.href}>Explore this workspace <ArrowUpRight size={17} /></a></div><p className="ig-preview-caption">A look inside the working demo · Historical Enfuce evidence shown</p></div></section>



      <section className="ig-proof-section"><div className="ig-container"><div className="ig-section-heading"><div><p className="ig-eyebrow">Trust has a trail</p><h2>Don’t stop at the answer.<br />See what supports it.</h2></div><p>A source reference is a starting point.<br />The calculation and its limitations matter, too.</p></div><EvidenceExample /><div className="ig-proof-principles"><span><Check size={15} /> Visible inputs and definitions</span><span><Check size={15} /> Open questions stay open</span><span><Check size={15} /> Your team makes the call</span></div></div></section>



      <section className="ig-why ig-container" id="why-trust">
        <div><p className="ig-eyebrow">Why Ingenium</p><h2>Faster diligence is not enough.<br />It also needs to be trusted.</h2><p>A summary can tell you what a document says. A diligence workflow should help you understand what supports it.</p></div>
        <div className="ig-why-questions">{['Where did this number come from?', 'What evidence supports this conclusion?', 'Do different sources contradict each other?', 'Which assumptions are still unverified?'].map(question => <p key={question}><span>?</span>{question}</p>)}<small>Ingenium connects the investment story to its evidence, so your team can move with clarity and rigor.</small></div>
      </section>

      <section className="ig-plans" id="plans"><div className="ig-container">
        <div className="ig-section-heading"><div><p className="ig-eyebrow">Business model</p><h2>Built for teams.<br />Priced for scale.</h2></div><p>A B2B SaaS subscription model based on team size, diligence volume, and enterprise requirements.</p></div>
        <div className="ig-plan-grid">{[
          { name: 'Team', for: 'For smaller VC and investment teams.', items: ['A focused diligence workspace', 'Source-linked research and reports', 'A structure that grows with your team'] },
          { name: 'Professional', for: 'For institutional VC, growth equity, and private equity teams.', items: ['Higher diligence volume', 'Repeatable research and review workflows', 'Reporting shaped around your process'] },
          { name: 'Enterprise', for: 'For larger investment organizations.', items: ['Discuss security and permission requirements', 'Explore integrations and firm-wide knowledge', 'Define organization-wide deployment needs'] },
        ].map(plan => <article key={plan.name}><h3>{plan.name}</h3><p>{plan.for}</p><span>Let’s find the right fit.</span><ul>{plan.items.map(item => <li key={item}><Check size={14} />{item}</li>)}</ul><a href={`mailto:${teamEmail}?subject=${encodeURIComponent('Ingenium ' + plan.name + ' pricing inquiry')}`}>Contact us for pricing <ArrowUpRight size={15} /></a></article>)}</div>
        <p className="ig-plan-note">Contact us to discuss scope, availability, and pricing. Plan details and enterprise capabilities are agreed with your team.</p>
      </div></section>

      <section className="ig-statement ig-container"><p className="ig-eyebrow">The principle behind Ingenium</p><h2>Every number traceable.<br />Every claim reviewable.<br />Every contradiction visible.</h2><p>Evidence infrastructure for faster,<br />more defensible investment decisions.</p></section>

      <section className="ig-faq ig-container"><div><p className="ig-eyebrow">A few things worth knowing</p><h2>A closer look.</h2><p>Start exploring.<br />The evidence is there to inspect.</p></div><div className="ig-faq-list">{FAQS.map((item, index) => <div className={`ig-faq-item ${openFaq === index ? 'is-open' : ''}`} key={item.question}><h3><button aria-expanded={openFaq === index} aria-controls={`ig-faq-answer-${index}`} onClick={() => setOpenFaq(openFaq === index ? null : index)}>{item.question}<ChevronDown size={18} /></button></h3><div id={`ig-faq-answer-${index}`} hidden={openFaq !== index}><p>{item.answer}</p></div></div>)}</div></section>

      <section className="ig-contact" id="contact"><div className="ig-container"><div className="ig-contact-copy"><p className="ig-eyebrow">See Ingenium in action</p><h2>Build conviction<br />on evidence.</h2><p>See how Ingenium can strengthen your next diligence workflow.</p><div className="ig-contact-actions"><a className="ig-button ig-button-light" href={DEMO}>Book a Demo <ArrowUpRight size={18} /></a><a className="ig-button ig-button-outline" href={CONTACT} target={teamEmail ? undefined : '_blank'} rel={teamEmail ? undefined : 'noopener noreferrer'}>Contact the team <ArrowUpRight size={17} /></a></div><p className="ig-contact-note"><a href={`mailto:${teamEmail}`}>{teamEmail}</a></p></div><div className="ig-contact-orbit" aria-hidden="true"><div /><div /><div /><BrandMark size={70} /></div></div></section>
    </main>
    <footer className="ig-footer ig-container"><div className="ig-footer-top"><div><a className="ig-wordmark" href="#/" onClick={goToTop} aria-label="Ingenium home"><BrandLogo /></a><p>Trusted diligence,<br />powered by the world’s evidence.</p></div><div className="ig-footer-links"><div><strong>Explore</strong><a href="#product">The platform</a><a href="#workflow">How it works</a><a href="#teams">Who it’s for</a><a href="#plans">Plans</a></div><div><strong>Get closer</strong><a href={DEMO}>See the Platform <ArrowUpRight size={12} /></a><a href={CONTACT} target={teamEmail ? undefined : '_blank'} rel="noopener noreferrer">Contact the team</a><a href="https://github.com/imnotmomo/acefire" target="_blank" rel="noopener noreferrer">Project on GitHub <ArrowUpRight size={12} /></a></div></div></div><div className="ig-footer-bottom"><span>© {new Date().getFullYear()} Ingenium</span><span>Built for evidence. Designed for judgment.</span><a href="#/" onClick={goToTop}>Back to top <ArrowRight size={13} /></a></div></footer>
  </div>
}
