/**
 * Long values (seeds, hashes, commands) shown shortened, with the full value on hover and a Copy button.
 * `ReplayCommand` is the CLI line that checks a round without trusting this website.
 */
import { useEffect, useState } from 'react'
import { shortHex } from '../lib/hex'
import './CopyValue.css'

interface CopyValueProps {
  /** What the value is, for the Copy button's accessible name. */
  readonly label: string
  readonly value: string
  /** What is shown; defaults to the value shortened. Copy always copies `value`. */
  readonly display?: string
  readonly className?: string
  /** Shown after the value, e.g. ✓ / ✗. */
  readonly mark?: string
  readonly as?: 'dd' | 'div'
}

/** A long value shown shortened (full value on hover) with a Copy button for the full value. */
export function CopyValue({ label, value, display = shortHex(value), className = '', mark, as: Tag = 'dd' }: CopyValueProps) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_500)
    return () => clearTimeout(timer)
  }, [copied])
  // The clipboard API only exists on secure pages (https or localhost); elsewhere the hover title shows the full value.
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined
  const copy = () => navigator.clipboard.writeText(value).then(() => setCopied(true), () => {})

  return (
    <Tag className={`copy-value ${className}`}>
      <span className="mono value" title={value}>
        {display}
      </span>
      {mark && <span className="mark">{mark}</span>}
      {canCopy && (
        <button type="button" className="link" onClick={() => void copy()} aria-label={`Copy ${label}`}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </Tag>
  )
}

/** The `npm run replay` line for a round, for anyone who'd rather not trust this page's own check. */
export function ReplayCommand({ intro, seedHex, roundId }: { intro: string; seedHex: string; roundId: bigint }) {
  return (
    <div className="replay-command">
      <span className="hint">{intro}</span>
      <CopyValue
        label="replay command"
        value={`npm run replay -- ${seedHex} ${roundId}`}
        display={`npm run replay -- ${shortHex(seedHex)} ${roundId}`}
        as="div"
      />
    </div>
  )
}
