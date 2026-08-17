import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/config.js'
import { isFrozen, tryUnfreeze } from '../lib/freeze.js'
import { getOrCreateRootState, deleteRootState } from '../lib/root-state.js'

const audit = { log: async () => {} }
const recoveryText = '我已经更换了API源，我信任这个API，继续对话'

function message(text) {
  return {
    id: `msg-${text}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

test('tryUnfreeze accepts exact recovery text and clears pending blocks', async () => {
  deleteRootState('root-freeze-1')
  const state = getOrCreateRootState('root-freeze-1')
  state.frozen = true
  state.pendingBlocks = [{
    id: 'p1',
    rootSessionId: 'root-freeze-1',
    agentId: 'agent1',
    unitId: 'u1',
    category: 'tool',
    reason: 'bad',
    contentPreview: 'bad',
    createdAt: Date.now(),
  }]

  const config = Config({})
  const result = await tryUnfreeze(state, config, [message(recoveryText), message('hello')], audit)

  assert.equal(result.unfrozen, true)
  assert.equal(result.remainingMessages.length, 1)
  assert.equal(result.remainingMessages[0].content[0].text, 'hello')
  assert.equal(state.frozen, false)
  assert.deepEqual(state.pendingBlocks, [])
})

test('tryUnfreeze rejects when recovery text is absent', async () => {
  deleteRootState('root-freeze-2')
  const state = getOrCreateRootState('root-freeze-2')
  state.frozen = true

  const config = Config({})
  const result = await tryUnfreeze(state, config, [message('普通消息')], audit)

  assert.equal(result.unfrozen, false)
  assert.equal(state.frozen, true)
})

test('isFrozen reflects state', () => {
  deleteRootState('root-freeze-3')
  const state = getOrCreateRootState('root-freeze-3')
  assert.equal(isFrozen(state), false)
  state.frozen = true
  assert.equal(isFrozen(state), true)
})

test('tryUnfreeze accepts recovery text inside a tool-result block', async () => {
  deleteRootState('root-freeze-4')
  const state = getOrCreateRootState('root-freeze-4')
  state.frozen = true
  const toolResultMessage = {
    id: 'tr-1',
    role: 'user',
    content: [{
      type: 'tool-result',
      toolCallId: 'call-1',
      content: [{ type: 'text', text: recoveryText }],
    }],
    source: { kind: 'tool', callId: 'call-1' },
  }

  const result = await tryUnfreeze(state, Config({}), [toolResultMessage], audit)
  assert.equal(result.unfrozen, true)
  assert.equal(result.remainingMessages.length, 0)
})

test('tryUnfreeze ignores non-text non-tool-result blocks', async () => {
  deleteRootState('root-freeze-5')
  const state = getOrCreateRootState('root-freeze-5')
  state.frozen = true
  const imageMessage = {
    id: 'img-1',
    role: 'user',
    content: [{ type: 'image' }],
    source: { kind: 'user' },
  }

  const result = await tryUnfreeze(state, Config({}), [imageMessage], audit)
  assert.equal(result.unfrozen, false)
  assert.equal(state.frozen, true)
})

test('tryUnfreeze handles non-text children inside tool-result blocks', async () => {
  deleteRootState('root-freeze-6')
  const state = getOrCreateRootState('root-freeze-6')
  state.frozen = true
  const toolResultMessage = {
    id: 'tr-img',
    role: 'user',
    content: [{
      type: 'tool-result',
      toolCallId: 'call-2',
      content: [{ type: 'image' }],
    }],
    source: { kind: 'tool', callId: 'call-2' },
  }

  const result = await tryUnfreeze(state, Config({}), [toolResultMessage], audit)
  assert.equal(result.unfrozen, false)
  assert.equal(state.frozen, true)
})
