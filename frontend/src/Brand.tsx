import './brand.css'
import { useId } from 'react'

/** Render the supplied artwork with display-only cropping and white removal. */
function Artwork({ wordmark = false, size = 26, className = '' }: { wordmark?: boolean; size?: number; className?: string }) {
  const filter = useId().replace(/:/g, '')
  return <svg className={className} width={wordmark ? undefined : size} height={wordmark ? undefined : size} viewBox={wordmark ? '570 115 1415 340' : '170 55 310 460'} role={wordmark ? 'img' : undefined} aria-label={wordmark ? 'Ingenium' : undefined} aria-hidden={wordmark ? undefined : true}><defs><filter id={filter} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1 -1 -1 0 3" /><feComponentTransfer><feFuncA type="discrete" tableValues="0 1 1 1 1 1 1 1" /></feComponentTransfer></filter></defs><image href="/images/brand/ingenium-logo.png" width="2172" height="724" filter={`url(#${filter})`} /></svg>
}
export function BrandMark({ size = 26, className = '' }: { size?: number; className?: string }) { return <Artwork size={size} className={`ingenium-mark ${className}`} /> }
export function BrandWordmark({ className = '' }: { className?: string }) { return <Artwork wordmark className={`ingenium-wordmark ${className}`} /> }
export function BrandLogo({ className = '' }: { className?: string }) { return <span className={`ingenium-logo ${className}`}><BrandMark /><BrandWordmark /></span> }
