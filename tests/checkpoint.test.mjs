import test from 'node:test'
import assert from 'node:assert/strict'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import { Config } from '../lib/config.js'
import { settleCheckpoint } from '../lib/checkpoint.js'
import { getOrCreateRootState, deleteRootState } from '../lib/root-state.js'

const audit = { log: async () => {} }

function stateWithPending(rootId) {
  const state = getOrCreateRootState(rootId)
  state.pendingBlocks = [{
    id: 'p1',
    rootSessionId: rootId,
    agentId: 'agent1',
    unitId: 'u1',
    category: 'tool',
    reason: 'bad',
    contentPreview: 'bad',
    createdAt: Date.now(),
  }]
  return state
}

test('checkpoint asks the root agent, not the child agent', async () => {
  deleteRootState('root-checkpoint-root-agent')
  const state = stateWithPending('root-checkpoint-root-agent')
  const rootAgent = { id: 'root-agent' }
  const childAgent = { id: 'child-agent' }
  let askedAgent
  const ctx = {
    agents: { get: () => rootAgent },
    get(name) {
      if (name !== 'userQuestions') return undefined
      return {
        ask: async (request) => {
          askedAgent = request.agent
          return { answers: [{ id: 'api-review-checkpoint', selected: ['全部允许'] }] }
        },
      }
    },
  }

  const decision = await settleCheckpoint(ctx, childAgent, state, Config({}), audit)
  assert.equal(decision, 'allow')
  assert.equal(askedAgent, rootAgent)
  assert.equal(state.pendingBlocks.length, 0)
})

test('checkpoint returns deny without asking when already frozen', async () => {
  deleteRootState('root-checkpoint-frozen')
  const state = stateWithPending('root-checkpoint-frozen')
  state.frozen = true
  let asked = false
  const ctx = {
    agents: { get: () => ({ id: 'root' }) },
    get(name) {
      if (name !== 'userQuestions') return undefined
      return {
        ask: async () => {
          asked = true
          return { answers: [{ id: 'api-review-checkpoint', selected: ['全部允许'] }] }
        },
      }
    },
  }

  const decision = await settleCheckpoint(ctx, { id: 'child' }, state, Config({}), audit)
  assert.equal(decision, 'deny')
  assert.equal(asked, false)
})

test('concurrent checkpoints for the same root are serialized', async () => {
  deleteRootState('root-checkpoint-concurrent')
  const state = stateWithPending('root-checkpoint-concurrent')
  const rootAgent = { id: 'root-agent' }
  let releaseAsk
  let askCount = 0
  const askGate = new Promise((resolve) => {
    releaseAsk = resolve
  })
  const ctx = {
    agents: { get: () => rootAgent },
    get(name) {
      if (name !== 'userQuestions') return undefined
      return {
        ask: async () => {
          askCount += 1
          if (askCount === 1) await askGate
          return { answers: [{ id: 'api-review-checkpoint', selected: ['全部允许'] }] }
        },
      }
    },
  }

  const first = settleCheckpoint(ctx, { id: 'child' }, state, Config({}), audit)
  // Let the first checkpoint acquire the lock and reach ask().
  await new Promise((resolve) => setTimeout(resolve, 5))
  const second = settleCheckpoint(ctx, { id: 'child' }, state, Config({}), audit)

  releaseAsk()
  const [d1, d2] = await Promise.all([first, second])
  assert.equal(d1, 'allow')
  assert.equal(d2, 'allow')
  // The second checkpoint waited, but by then the first had cleared pending.
  assert.equal(askCount, 1)
})

test('checkpoint uses deny when the user cancels the question', async () => {
  deleteRootState('root-checkpoint-cancel')
  const state = stateWithPending('root-checkpoint-cancel')
  const ctx = {
    agents: { get: () => ({ id: 'root' }) },
    get(name) {
      if (name !== 'userQuestions') return undefined
      return {
        ask: async () => {
          throw new UserQuestionError('cancelled', 'ASK_CANCELLED')
        },
      }
    },
  }

  const decision = await settleCheckpoint(ctx, { id: 'child' }, state, Config({}), audit)
  assert.equal(decision, 'deny')
  assert.equal(state.frozen, true)
})

test('checkpoint uses noUserAction allow when the question channel fails', async () => {
  deleteRootState('root-checkpoint-fallback-allow')
  const state = stateWithPending('root-checkpoint-fallback-allow')
  const ctx = {
    agents: { get: () => ({ id: 'root' }) },
    get(name) {
      if (name !== 'userQuestions') return undefined
      return {
        ask: async () => {
          throw new Error('channel down')
        },
      }
    },
  }

  const decision = await settleCheckpoint(ctx, { id: 'child' }, state, Config({ noUserAction: 'allow' }), audit)
  assert.equal(decision, 'allow')
  assert.equal(state.pendingBlocks.length, 0)
  assert.equal(state.frozen, false)
})

test('checkpoint uses noUserAction allow when no userQuestions channel exists', async () => {
  deleteRootState('root-checkpoint-no-channel')
  const state = stateWithPending('root-checkpoint-no-channel')
  const ctx = {
    agents: { get: () => ({ id: 'root' }) },
    get: () => undefined,
  }

  const decision = await settleCheckpoint(ctx, { id: 'child' }, state, Config({ noUserAction: 'allow' }), audit)
  assert.equal(decision, 'allow')
  assert.equal(state.pendingBlocks.length, 0)
})

test('checkpoint denies when the answer does not match any question', async () => {
  deleteRootState('root-checkpoint-no-answer')
  const state = stateWithPending('root-checkpoint-no-answer')
  const ctx = {
    agents: { get: () => ({ id: 'root' }) },
    get(name) {
      if (name !== 'userQuestions') return undefined
      return {
        ask: async () => ({ answers: [] }),
      }
    },
  }

  const decision = await settleCheckpoint(ctx, { id: 'child' }, state, Config({}), audit)
  assert.equal(decision, 'deny')
  assert.equal(state.frozen, true)
})
