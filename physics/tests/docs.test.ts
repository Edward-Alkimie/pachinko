import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as physics from '../src/index'

const ARCHITECTURE_MD = fileURLToPath(new URL('../../docs/ARCHITECTURE.md', import.meta.url))

describe('docs/ARCHITECTURE.md', () => {
  it('mentions every public function and constant of @pachinko/physics', () => {
    const doc = readFileSync(ARCHITECTURE_MD, 'utf8')
    const missing = Object.keys(physics).filter((name) => !doc.includes(`\`${name}\``))
    expect(missing, `add these to docs/ARCHITECTURE.md: ${missing.join(', ')}`).toEqual([])
  })
})
