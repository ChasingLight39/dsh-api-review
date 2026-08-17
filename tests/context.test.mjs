import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/config.js'
import { appendUnit, estimateTokens, trimContextIfNeeded, unitTokens } from '../lib/context.js'
import { getOrCreateRootState, deleteRootState } from '../lib/root-state.js'

function makeUnit(id, content) {
  return {
    id,
    globalSeq: 0,
    rootSessionId: 'root1',
    agentId: 'agent1',
    category: 'user',
    content,
    sourceKind: 'user',
    review: false,
    block: false,
    includeContext: true,
    occurredAt: Date.now(),
  }
}

test('estimateTokens approximates 4 chars per token', () => {
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcdefghijklmnop'), 4)
})

test('unitTokens delegates to estimateTokens', () => {
  assert.equal(unitTokens(makeUnit('u', 'abcd')), 1)
})

test('trim removes oldest units until remaining <= target', () => {
  deleteRootState('root1')
  const state = getOrCreateRootState('root1')
  const config = Config({
    maxContextTokens: 100,
    contextTrimThreshold: 0.8,
    contextTrimTarget: 0.4,
  })

  // 120 chars -> 30 tokens each.
  for (let i = 0; i < 3; i += 1) {
    appendUnit(state, makeUnit(`u${i}`, 'x'.repeat(120)))
  }

  assert.equal(state.contextBuffer.length, 3)
  const result = trimContextIfNeeded(state, config)
  assert.ok(result)
  assert.equal(result.removedUnits, 2)
  assert.equal(state.contextBuffer.length, 1)
  assert.equal(state.contextBuffer[0].id, 'u2')
  assert.ok(result.remainingTokens <= 40)
})

test('trim keeps the newest unit even when it alone exceeds target', () => {
  deleteRootState('root-trim-single')
  const state = getOrCreateRootState('root-trim-single')
  const config = Config({
    maxContextTokens: 100,
    contextTrimThreshold: 0.8,
    contextTrimTarget: 0.4,
  })

  // 400 chars -> 100 tokens, above the 40-token target.
  appendUnit(state, makeUnit('only', 'x'.repeat(400)))

  const result = trimContextIfNeeded(state, config)
  assert.ok(result)
  assert.equal(state.contextBuffer.length, 1)
  assert.equal(state.contextBuffer[0].id, 'only')
})
