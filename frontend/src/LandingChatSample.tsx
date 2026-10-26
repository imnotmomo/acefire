import { useEffect, useState } from 'react'
import { ArrowUpRight, FileText, Pause, Play, RotateCcw } from 'lucide-react'
import { BrandMark } from './Brand'
import './landing-chat-sample.css'

const samples = [
  {
    label: 'Trace a number', question: 'Where does Enfuce’s operating income come from?',
    answer: 'The historical H1 2020 worksheet records €3,452,682.81 in operating income. Its recorded inputs are €3,417,663.76 in revenue and €35,019.05 in other income. Inspect the original cells and calculation before using this figure.',
    source: 'June 2020 Financials.xlsx', locator: 'P&L - Group!I6 · Historical snapshot',
    href: '#/project/enfuce/dashboard', action: 'Inspect the evidence',
  },
  {
    label: 'Challenge a claim', question: 'Can I treat operating income as revenue?',
    answer: 'Check the definition first. In this historical example, operating income includes other income. The summary labels the total as revenue. Review the source definitions and period before treating these labels as equivalent.',
    source: 'Five-year financial summary', locator: 'F4 · Compare with P&L - Group!B4:I6',
    href: '#/project/enfuce/dashboard', action: 'Review the source context',
  },
  {
    label: 'Build a report', question: 'How do I turn this evidence into a report?',
    answer: 'Open Report Builder, select the modules your team needs, and set the scope. In Review, select a cited passage to inspect its supporting evidence. Record your edits before exporting the report.',
    source: 'Explore the report workflow', locator: 'Build → Review → Export',
    href: '#/project/enfuce/report/build', action: 'Open Report Builder',
  },
]

export default function LandingChatSample() {
  const [selected, setSelected] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const sample = samples[selected]
  const total = sample.question.length + sample.answer.length
  const position = reduced ? total : cursor
  const complete = position >= total
  const answering = position >= sample.question.length

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (paused || reduced || cursor >= total) return
    const timer = window.setTimeout(() => setCursor(value => value + 1), cursor === 0 ? 600 : cursor === sample.question.length ? 450 : answering ? 16 : 28)
    return () => window.clearTimeout(timer)
  }, [cursor, total, paused, reduced, answering, sample.question.length])

  function start(index: number) { setSelected(index); setCursor(0); setPaused(false) }

  return <section className="ig-chat-sample" aria-label="Ingenium chat demo">
    <header className="ig-chat-header">
      <span className="ig-chat-brand"><BrandMark size={27} /></span>
      <div><strong>Ask Ingenium</strong><span>Follow the answer to its evidence.</span></div>
      <span className="ig-chat-badge">Sample</span>
    </header>
    <div className="ig-chat-conversation" aria-hidden="true">
      <div className="ig-chat-question"><span>You</span><p>{sample.question.slice(0, Math.min(position, sample.question.length)) || '\u00a0'}{!answering && !paused && <i className="ig-chat-cursor" />}</p></div>
      <div className="ig-chat-answer"><span><BrandMark size={18} /> Ingenium</span><p>{answering ? sample.answer.slice(0, position - sample.question.length) : 'Let’s follow the evidence.'}{answering && !complete && !paused && <i className="ig-chat-cursor" />}</p></div>
    </div>
    <div className="ig-chat-sr" role="status" aria-live="polite" aria-atomic="true">{complete ? `${sample.question} ${sample.answer}` : 'Playing a sample conversation.'}</div>
    <a className="ig-chat-source is-ready" href={sample.href}>
      <FileText size={19} /><span><strong>{sample.source}</strong><small>{sample.locator}</small></span><ArrowUpRight size={16} />
    </a>
    <div className="ig-chat-prompts" role="group" aria-label="Sample questions">{samples.map((item, index) => <button key={item.label} aria-pressed={selected === index} onClick={() => start(index)}>{item.label}</button>)}</div>
    <footer className="ig-chat-footer"><span>Scripted demo · No live AI request</span><div>{!complete && !reduced && <button aria-label={paused ? 'Resume demo' : 'Pause demo'} onClick={() => setPaused(value => !value)}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>}<button aria-label="Replay demo" onClick={() => start(selected)}><RotateCcw size={15} /></button></div></footer>
    <a className="ig-chat-open" href={sample.href}>{sample.action}<ArrowUpRight size={15} /></a>
  </section>
}
