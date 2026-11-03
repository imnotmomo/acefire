import { useEffect, useState } from 'react'
import { ArrowUpRight, BookOpen, FileText, Pause, Play, RotateCcw } from 'lucide-react'
import { BrandMark } from './Brand'
import MathMarkdown from './MathMarkdown'
import './landing-chat-sample.css'

const samples = [
  {
    label: 'Trace a number', context: 'Company chat · Dashboard',
    question: 'How much of Enfuce’s €22m ARR is backed by contracts?',
    answer: 'The deck gives a €22m Top 50 forecast (p.30), not contracted revenue. The cited evidence does not establish a signed ARR amount. Request contracts and recognized revenue before using it as actual performance.',
    source: 'ARR forecast evidence', sourceIcon: FileText, locator: 'Enfuce Summary - April 2020.pdf · p.30',
    href: '#/project/enfuce-documents/dashboard', action: 'Explore the dashboard',
  },
  {
    label: 'Challenge a claim', context: 'Source search · Data room',
    question: 'Where is the evidence for Enfuce’s AIS/PIS licence?',
    answer: 'The deck states that Enfuce holds an AIS/PIS licence (p.22). Inspect the stored passage and page reference. This is a company claim; request the licence number, issuing authority and permitted markets for independent validation.',
    source: 'AIS/PIS licence statement', sourceIcon: FileText, locator: 'Enfuce Summary - April 2020.pdf · p.22',
    href: '#/project/enfuce-documents/data-room', action: 'Explore the data room',
  },
  {
    label: 'Build a report', context: 'Company chat · Report',
    question: 'What must we verify before taking this case to IC?',
    answer: 'Prioritize customer retention, revenue-target assumptions and licensing scope. The deck provides a customer count (p.4), expansion targets (p.16) and a licence claim (p.22). Record supporting contracts, customer references and regulatory documents as open diligence requests.',
    source: 'Explore the report workflow', sourceIcon: BookOpen, locator: 'Build → Review → Export · Sources pp.4, 16, 22',
    href: '#/project/enfuce-documents/report/build', action: 'Open Report Builder',
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
      <div><strong>Ask Ingenium</strong><span>{sample.context}</span></div>
      <span className="ig-chat-badge">Sample</span>
    </header>
    <div className="ig-chat-conversation" aria-hidden="true">
      <div className="ig-chat-question"><span>You</span><p>{sample.question.slice(0, Math.min(position, sample.question.length)) || '\u00a0'}{!answering && !paused && <i className="ig-chat-cursor" />}</p></div>
      <div className="ig-chat-answer"><span><BrandMark size={18} /> Ingenium</span><div className="ig-chat-answer-body"><MathMarkdown text={answering ? sample.answer.slice(0, position - sample.question.length) : 'Let’s follow the evidence.'} />{answering && !complete && !paused && <i className="ig-chat-cursor" />}</div></div>
    </div>
    <div className="ig-chat-sr" role="status" aria-live="polite" aria-atomic="true">{complete ? `${sample.question} ${sample.answer}` : 'Playing a sample conversation.'}</div>
    <a className="ig-chat-source is-ready" href={sample.href}>
      <sample.sourceIcon size={19} /><span><strong>{sample.source}</strong><small>{sample.locator}</small></span><ArrowUpRight size={16} />
    </a>
    <div className="ig-chat-prompts" role="group" aria-label="Sample questions">{samples.map((item, index) => <button key={item.label} aria-pressed={selected === index} onClick={() => start(index)}>{item.label}</button>)}</div>
    <footer className="ig-chat-footer"><span>Scripted demo · No live AI request</span><div>{!complete && !reduced && <button aria-label={paused ? 'Resume demo' : 'Pause demo'} onClick={() => setPaused(value => !value)}>{paused ? <Play size={15} /> : <Pause size={15} />}</button>}<button aria-label="Replay demo" onClick={() => start(selected)}><RotateCcw size={15} /></button></div></footer>
    <a className="ig-chat-open" href={sample.href}>{sample.action}<ArrowUpRight size={15} /></a>
  </section>
}
