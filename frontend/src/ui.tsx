import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BrandMark } from './Brand'
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BarChart3, Bell, BookOpen, Building2, Calculator, ChartNoAxesCombined, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Contact, Copy, Download, ExternalLink, File, FileCheck2, FileSpreadsheet, FileText, Flag, Folder, FolderOpen, Globe2, GripVertical, History, Layers3, LayoutDashboard, Link2, ListFilter, LoaderCircle, Maximize2, Menu, MessageCircle, MoreHorizontal, Pencil, Plus, Rocket, Scale, Search, Send, Settings2, ShieldCheck, Sparkles, Trash2, Upload, Users, WandSparkles, X, Zap } from 'lucide-react'

const icons = { activity: Activity, down: ArrowDown, back: ArrowLeft, arrow: ArrowRight, up: ArrowUp, outward: ArrowUpRight, chart: BarChart3, bell: Bell, book: BookOpen, building: Building2, calculator: Calculator, trend: ChartNoAxesCombined, check: Check, chevronDown: ChevronDown, chevron: ChevronRight, help: CircleHelp, clock: Clock3, contact: Contact, copy: Copy, download: Download, external: ExternalLink, file: File, fileCheck: FileCheck2, sheet: FileSpreadsheet, document: FileText, flag: Flag, folder: Folder, folderOpen: FolderOpen, globe: Globe2, grip: GripVertical, history: History, layers: Layers3, dashboard: LayoutDashboard, link: Link2, filter: ListFilter, loading: LoaderCircle, maximize: Maximize2, menu: Menu, chat: MessageCircle, more: MoreHorizontal, pencil: Pencil, plus: Plus, rocket: Rocket, scale: Scale, search: Search, send: Send, settings: Settings2, shield: ShieldCheck, sparkles: Sparkles, trash: Trash2, upload: Upload, users: Users, wand: WandSparkles, x: X, zap: Zap }
export function Icon({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  if (['sparkles', 'wand', 'zap'].includes(name)) return <BrandMark size={size} className={className} />
  const Component = icons[name as keyof typeof icons] ?? FileText
  return <Component size={size} strokeWidth={1.7} aria-hidden="true" className={className} />
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>
}
export function Empty({ icon = 'folder', title, text, children }: { icon?: string; title: string; text: string; children?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p>{text}</p>{children}</div>
}
export function Dialog({ title, subtitle, onClose, children, className = '' }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  // Capture before React commits autoFocus inputs inside the new dialog.
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const before = opener.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current() }
      if (event.key === 'Tab') {
        const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]') ?? []).filter(e => e.getClientRects().length)
        const first = elements[0], last = elements[elements.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); before?.focus() }
  }, [])
  const dialog = <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className={`dialog ${className}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}>
    <div className="dialog-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}><Icon name="x" /></button></div>
    {children}
  </div></div>
  // Page opacity creates a stacking context; overlays belong above the shell.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
