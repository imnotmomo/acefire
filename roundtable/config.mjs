import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function settings() {
  const file = process.env.ACEFIRE_ROUNDTABLE_ENV || fileURLToPath(new URL('../runtime/roundtable-diligence/.env', import.meta.url))
  if (existsSync(file)) process.loadEnvFile(file)
  const required = name => {
    if (!process.env[name]?.trim()) throw new Error(`Missing ${name}; initialize runtime/roundtable-diligence with the official CLI.`)
    return process.env[name]
  }
  const project = required('ROUNDTABLE_PROJECT')
  const roles = { answer: 'COMPS', reviewer: 'RED_FLAGS', coordinator: 'MEMO_WRITER' }
  const identity = role => {
    const prefix = roles[role]
    return { key: required(`${prefix}_KEY`), id: required(`${prefix}_ID`), name: required(`${prefix}_NAME`) }
  }
  // The CLI template's synthetic market/comparables handlers are never imported.
  return {
    project, identity,
    url: process.env.ROUNDTABLE_URL || 'https://roundtable.bot',
    backend: 'http://127.0.0.1:8000',
    allowedDeals: new Set((process.env.ACEFIRE_ROUNDTABLE_DEALS || 'enfuce-2020').split(',').map(s => s.trim())),
    allowUpload: process.env.ROUNDTABLE_ALLOW_EVIDENCE_UPLOAD === '1',
  }
}
