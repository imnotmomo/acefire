import { useEffect, useRef, useState } from 'react'
import type { CompanyLogo } from './companyLogoApi'
import { cachedCompanyLogo, companyLogoBlob, setCompanyLogoWebsite } from './companyLogoApi'
import { Dialog, Icon } from './ui'
import './company-logo.css'

export function CompanyLogoCover({ name, dealId, logo, onStatus }: { name: string; dealId: string; logo: CompanyLogo; onStatus: (logo: CompanyLogo) => void }) {
  const [url, setUrl] = useState('')
  const [polling, setPolling] = useState(logo.status === 'fetching')
  useEffect(() => {
    if (logo.status !== 'ready') { setUrl(''); return }
    const controller = new AbortController(); let asset = ''
    void companyLogoBlob(logo, dealId, controller.signal).then(blob => {
      if (controller.signal.aborted) return
      asset = URL.createObjectURL(blob); setUrl(asset)
    }).catch(() => { if (!controller.signal.aborted) setUrl('') })
    return () => { controller.abort(); if (asset) URL.revokeObjectURL(asset) }
  }, [dealId, logo.status, logo.sha256, logo.asset_path])
  const statusRef = useRef(onStatus); statusRef.current = onStatus
  useEffect(() => {
    if (logo.status === 'awaiting_website') {
      setPolling(false)
      const controller = new AbortController()
      // Initial-file processing may have completed while this card was unmounted.
      // This endpoint reads private cached state only; it never starts a lookup.
      void cachedCompanyLogo(dealId, controller.signal).then(next => { if (!controller.signal.aborted && next && next.status !== 'awaiting_website') statusRef.current(next) }).catch(() => {})
      return () => controller.abort()
    }
    if (logo.status !== 'fetching') { setPolling(false); return }
    setPolling(true)
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, attempts = 0
    const poll = async () => {
      try {
        const next = await cachedCompanyLogo(dealId, controller.signal)
        if (controller.signal.aborted) return
        if (next && next.status !== 'fetching') { setPolling(false); statusRef.current(next); return }
      } catch { if (controller.signal.aborted) return }
      if (++attempts < 20 && !controller.signal.aborted) timer = setTimeout(poll, 1000)
      else if (!controller.signal.aborted) setPolling(false)
    }
    timer = setTimeout(poll, 750)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [dealId, logo.status])
  return <div className="company-logo-cover">{url ? <img src={url} alt={`${name} website icon`} title={`Cached website icon from ${logo.domain}`} onError={() => setUrl('')} /> : <><Icon name="folder" size={40} /><span>{name}</span></>}{logo.status === 'fetching' && <small>{polling ? <><Icon name="loading" size={12} />Finding website icon…</> : 'Icon lookup is still pending. Check the saved result later.'}</small>}</div>
}

export function CompanyLogoSetup({ name, dealId, onStatus }: { name: string; dealId: string; onStatus: (logo: CompanyLogo) => void }) {
  const [open, setOpen] = useState(false), [website, setWebsite] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  async function save() {
    if (request.current) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    try {
      const logo = await setCompanyLogoWebsite(dealId, website, controller.signal)
      if (controller.signal.aborted) return
      if (!logo) throw new Error('This workspace is not eligible for an automatic company icon.')
      onStatus(logo); setOpen(false)
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The website could not be saved.') }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  return <><button className="text-button company-logo-setup" onClick={() => setOpen(true)}><Icon name="globe" size={13} />Set website for icon</button>{open && <Dialog title="Company website" subtitle={name} onClose={() => { request.current?.abort(); request.current = null; setBusy(false); setOpen(false) }}><form className="dialog-body" onSubmit={event => { event.preventDefault(); void save() }}><label>Public company website<input aria-label="Public company website" value={website} disabled={busy} maxLength={2048} placeholder="example.com" onChange={event => { setWebsite(event.target.value); setError('') }} autoFocus /></label><p className="preview-note">We use this public domain to find and cache its website icon once. No uploaded file text is sent. Use the company’s own website to avoid choosing another organization.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button className="button primary" disabled={busy || !website.trim()} type="submit"><Icon name={busy ? 'loading' : 'globe'} size={15} />{busy ? 'Saving website…' : 'Find company icon'}</button></div></form></Dialog>}</>
}

export function CompanyLogoCacheCheck({ dealId, onStatus }: { dealId: string; onStatus: (logo: CompanyLogo) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  async function check() {
    if (request.current) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    try { const next = await cachedCompanyLogo(dealId, controller.signal); if (!controller.signal.aborted && next) onStatus(next) }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Saved icon status unavailable.') }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  return <div><button className="text-button company-logo-setup" disabled={busy} onClick={() => void check()}><Icon name={busy ? 'loading' : 'history'} size={13} />{busy ? 'Checking saved icon…' : 'Check saved icon'}</button>{error && <small className="form-error" role="alert">{error}</small>}</div>
}
