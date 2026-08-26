import { useId } from 'react'
import type { Language } from '../i18n'

// Flag emoji (🇬🇧 / 🇵🇹) are regional-indicator letter pairs, and Windows ships
// no font that maps them to a flag glyph — so Chrome and Edge render the bare
// letters "GB" / "PT". These inline SVGs look identical on every OS.
//
// Both use preserveAspectRatio="none" so each fills the same 20x14 CSS box
// regardless of its own aspect ratio, keeping the two buttons visually even.

export default function Flag({ code }: { code: Language }) {
  return code === 'pt' ? <FlagPT /> : <FlagGB />
}

function FlagGB() {
  // useId keeps the clipPath unique if this ever renders more than once; the
  // colons React generates are stripped because they sit inside a url(#...).
  const clip = `gb-${useId().replace(/:/g, '')}`
  return (
    <svg className="lang-flag" viewBox="0 0 60 30" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <clipPath id={clip}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <path d="M0,0 v30 h60 v-30 z" fill="#00247d" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${clip})`} stroke="#cf142b" strokeWidth="4" />
      <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#cf142b" strokeWidth="6" />
    </svg>
  )
}

function FlagPT() {
  return (
    <svg className="lang-flag" viewBox="0 0 60 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <rect width="60" height="40" fill="#da291c" />
      <rect width="24" height="40" fill="#046a38" />
      <g transform="translate(24 20)">
        <g fill="none" stroke="#ffd100" strokeWidth="1.8">
          <circle r="8.4" />
          <ellipse rx="4.2" ry="8.4" />
          <path d="M-8.4,0 H8.4" />
        </g>
        <path d="M-4.6,-6.2 h9.2 v6.4 a4.6,5.2 0 0 1 -9.2,0 z" fill="#fff" stroke="#da291c" strokeWidth="1.8" />
      </g>
    </svg>
  )
}
