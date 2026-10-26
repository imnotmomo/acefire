import './brand.css'
import { useId } from 'react'

/** Native transparent vectors: no bitmap crop, white-removal filter or tagline. */
export function BrandMark({ size = 26, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '')
  return <svg className={`ingenium-mark ${className}`} width={size} height={size} viewBox="0 0 64 90" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#8b7bfc" /><stop offset="1" stopColor="#9fa4ff" /></linearGradient>
      <linearGradient id={`${id}-dark`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#6952cf" /><stop offset="1" stopColor="#3c237c" /></linearGradient>
    </defs>
    <path d="M35 1 60 18 44 29 25 16V10Z" fill={`url(#${id}-light)`} />
    <path d="M3 36 24 23V52L3 65Z" fill={`url(#${id}-light)`} />
    <path d="M40 37 61 24V53L40 67Z" fill={`url(#${id}-dark)`} />
    <path d="M22 61 39 72V85L34 88 6 70Z" fill={`url(#${id}-dark)`} />
  </svg>
}
export function BrandWordmark({ className = '' }: { className?: string }) {
  return <svg className={`ingenium-wordmark ${className}`} viewBox="0 0 440 118" role="img" aria-label="Ingenium">
    <text x="2" y="88" textLength="432" lengthAdjust="spacingAndGlyphs" fill="currentColor" fontFamily="'Times New Roman', Times, 'Liberation Serif', serif" fontWeight="700" fontSize="104">Ingenium</text>
  </svg>
}
export function BrandLogo({ className = '' }: { className?: string }) {
  return <span className={`ingenium-logo ${className}`}><BrandMark /><BrandWordmark /></span>
}
