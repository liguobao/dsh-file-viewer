import { describe, it, expect } from 'vitest'
import {
  classifySize,
  initialLoadPlan,
  allowWholeRead,
  NORMAL_MAX_BYTES,
  STREAM_MAX_BYTES,
} from '../src/core/large-file.js'

describe('large-file strategy', () => {
  it('classifies by size thresholds', () => {
    expect(classifySize(0)).toBe('normal')
    expect(classifySize(NORMAL_MAX_BYTES)).toBe('normal')
    expect(classifySize(NORMAL_MAX_BYTES + 1)).toBe('stream')
    expect(classifySize(STREAM_MAX_BYTES)).toBe('stream')
    expect(classifySize(STREAM_MAX_BYTES + 1)).toBe('large')
  })

  it('plans a complete read for normal files', () => {
    const plan = initialLoadPlan(1024)
    expect(plan.mode).toBe('normal')
    expect(plan.complete).toBe(true)
    expect(plan.initialBytes).toBe(1024)
    expect(plan.hint).toBeUndefined()
  })

  it('plans a partial read with hint for large files', () => {
    const plan = initialLoadPlan(437 * 1024 * 1024)
    expect(plan.mode).toBe('large')
    expect(plan.complete).toBe(false)
    expect(plan.initialBytes).toBeLessThan(STREAM_MAX_BYTES)
    expect(plan.hint).toMatch(/MB/)
  })

  it('allows whole reads only under the cap', () => {
    expect(allowWholeRead(1024)).toBe(true)
    expect(allowWholeRead(NORMAL_MAX_BYTES)).toBe(true)
    expect(allowWholeRead(STREAM_MAX_BYTES)).toBe(true)
    expect(allowWholeRead(STREAM_MAX_BYTES + 1)).toBe(false)
  })
})
