import { describe, expect, it } from 'vitest'
import { roundSteps } from './roundSteps'

const states = (stage: Parameters<typeof roundSteps>[0], challenged = false) =>
  roundSteps(stage, challenged).map((s) => `${s.label}:${s.state}`)

describe('roundSteps', () => {
  it('shows nothing before the bet or on an error', () => {
    expect(roundSteps('idle', false)).toEqual([])
    expect(roundSteps('error', false)).toEqual([])
  })

  it('lights the current step and ticks the ones before it', () => {
    expect(states('playing')).toEqual([
      'Bet:done',
      'Seed:done',
      'Balls:current',
      'Operator:todo',
      'Window:todo',
      'Paid:todo',
    ])
    expect(states('verifying')[4]).toBe('Window:current')
  })

  it('names the committee step once the round is challenged, and ticks everything when final', () => {
    expect(states('challenged')[4]).toBe('Committee:current')
    expect(states('final', true)).toEqual([
      'Bet:done',
      'Seed:done',
      'Balls:done',
      'Operator:done',
      'Committee:done',
      'Paid:done',
    ])
  })

  it('ends in Refunded when the operator never reported', () => {
    expect(states('refunded')).toEqual(['Bet:done', 'Seed:done', 'Balls:done', 'Refunded:done'])
  })
})
