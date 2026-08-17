import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/config.js'
import { ReviewEngine } from '../lib/engine.js'
import { getRootState, getOrCreateRootState, deleteRootState } from '../lib/root-state.js'

const audit = { log: async () => {} }

function makeUnit(rootId, agentId, category, content, review, block, includeContext) {
  return {
    id: `${category}-${Date.now()}-${Math.random()}`,
    globalSeq: 1,
    rootSessionId: rootId,
    agentId,
    category,
    content,
    sourceKind: 'model',
    review,
    block,
    includeContext,
    occurredAt: Date.now(),
  }
}

test('async review appends context and creates pendingBlock on block verdict', async () => {
  deleteRootState('root1')
  const config = Config({
    tool: { review: true, block: false, includeContext: true },
  })
  const captured = []
  const fakeScheduler = {
    enqueue(task) {
      captured.push(task)
      return undefined
    },
  }
  const engine = new ReviewEngine(config, audit, fakeScheduler)
  const unit = makeUnit('root1', 'agent1', 'tool', 'exfiltrate', true, false, true)

  await engine.reviewAsync(unit)

  assert.equal(captured.length, 1)
  assert.equal(captured[0].sync, false)

  const state = getRootState('root1')
  assert.equal(state.contextBuffer.length, 1)

  await engine.handleAsyncResult(captured[0], { verdict: 'block', reason: 'bad' })
  assert.equal(state.pendingBlocks.length, 1)
  assert.equal(state.pendingBlocks[0].category, 'tool')
})

test('blocking review allows when user chooses allow', async () => {
  deleteRootState('root2')
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    tool: { review: true, block: true, includeContext: true },
  })
  const interaction = {
    ask: async () => ({
      answers: [{ id: 'api-review-checkpoint', selected: ['全部允许'] }],
    }),
  }
  const fakeCtx = {
    agents: { get: () => ({ id: 'root2' }) },
    get: (name) => (name === 'userQuestions' ? interaction : undefined),
  }
  const fakeScheduler = {
    enqueue(task) {
      if (task.sync) return Promise.resolve({ verdict: 'block', reason: 'bad' })
      return undefined
    },
  }
  const engine = new ReviewEngine(config, audit, fakeScheduler)
  const unit = makeUnit('root2', 'agent1', 'tool', 'bad', true, true, true)

  const outcome = await engine.reviewBlocking(fakeCtx, { id: 'agent1' }, unit)

  assert.equal(outcome.allow, true)
  const state = getRootState('root2')
  assert.equal(state.pendingBlocks.length, 0)
  assert.equal(state.frozen, false)
})

test('blocking review freezes when user chooses deny', async () => {
  deleteRootState('root3')
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    tool: { review: true, block: true, includeContext: true },
  })
  const interaction = {
    ask: async () => ({
      answers: [{ id: 'api-review-checkpoint', selected: ['存在拒绝'] }],
    }),
  }
  const fakeCtx = {
    agents: { get: () => ({ id: 'root3' }) },
    get: (name) => (name === 'userQuestions' ? interaction : undefined),
  }
  const fakeScheduler = {
    enqueue(task) {
      if (task.sync) return Promise.resolve({ verdict: 'block', reason: 'bad' })
      return undefined
    },
  }
  const engine = new ReviewEngine(config, audit, fakeScheduler)
  const unit = makeUnit('root3', 'agent1', 'tool', 'bad', true, true, true)

  const outcome = await engine.reviewBlocking(fakeCtx, { id: 'agent1' }, unit)

  assert.equal(outcome.allow, false)
  const state = getRootState('root3')
  assert.equal(state.frozen, true)
  assert.ok(state.pendingBlocks.length > 0)
})

test('system external review does not append to contextBuffer', async () => {
  deleteRootState('root4')
  const config = Config({
    system: { review: true, block: false, includeContext: true },
  })
  const captured = []
  const fakeScheduler = {
    enqueue(task) {
      captured.push(task)
      return undefined
    },
  }
  const engine = new ReviewEngine(config, audit, fakeScheduler)
  const unit = makeUnit('root4', 'agent1', 'system', 'system prompt', true, false, true)

  // Simulate a root that already exists from earlier activity.
  getOrCreateRootState('root4')
  await engine.reviewAsyncExternal(unit, [], undefined)

  assert.equal(captured.length, 1)
  const state = getRootState('root4')
  assert.equal(state.contextBuffer.length, 0)
})

test('block=true with review=false still appends includeContext unit', async () => {
  deleteRootState('root5')
  const config = Config({
    tool: { review: false, block: true, includeContext: true },
  })
  const fakeCtx = {
    agents: { get: () => undefined },
    get: () => undefined,
  }
  const fakeScheduler = {
    enqueue() {
      throw new Error('should not enqueue review when review=false')
    },
  }
  const engine = new ReviewEngine(config, audit, fakeScheduler)
  const unit = makeUnit('root5', 'agent1', 'tool', 'checkpoint-only', false, true, true)

  const outcome = await engine.reviewBlocking(fakeCtx, { id: 'agent1' }, unit)

  assert.equal(outcome.allow, true)
  const state = getRootState('root5')
  assert.equal(state.contextBuffer.length, 1)
  assert.equal(state.contextBuffer[0].content, 'checkpoint-only')
})

test('async result after root deletion does not recreate root state', async () => {
  deleteRootState('root6')
  const config = Config({
    tool: { review: true, block: false, includeContext: true },
  })
  const engine = new ReviewEngine(config, audit, {
    enqueue() { return undefined },
  })
  const unit = makeUnit('root6', 'agent1', 'tool', 'late result', true, false, true)

  await engine.handleAsyncResult(
    { unit, rootSessionId: 'root6', agentId: 'agent1' },
    { verdict: 'block', reason: 'late' },
  )

  assert.equal(getRootState('root6'), undefined)
})

test('setSystemSnapshot and systemSnapshotFor feed the review task', async () => {
  deleteRootState('root7')
  const config = Config({
    system: { includeContext: true },
    user: { review: true, block: false, includeContext: false },
  })
  const captured = []
  const engine = new ReviewEngine(config, audit, {
    enqueue(task) {
      captured.push(task)
      return undefined
    },
  })
  await engine.setSystemSnapshot('root7', 'agent1', 'system prompt v1')
  const unit = makeUnit('root7', 'agent1', 'user', 'hello', true, false, false)

  await engine.reviewAsync(unit)

  assert.equal(captured.length, 1)
  assert.equal(captured[0].systemSnapshot.content, 'system prompt v1')
})

test('getContextSnapshot returns current buffer snapshot', async () => {
  deleteRootState('root8')
  const config = Config({
    user: { review: false, block: false, includeContext: true },
  })
  const engine = new ReviewEngine(config, audit, { enqueue() { return undefined } })
  await engine.prepareUnit(makeUnit('root8', 'agent1', 'user', 'first', false, false, true))
  const snapshot = await engine.getContextSnapshot('root8')
  assert.equal(snapshot.length, 1)
  assert.equal(snapshot[0].content, 'first')
})

test('prepareUnit does not append when includeContext is false', async () => {
  deleteRootState('root8b')
  const config = Config({
    user: { review: false, block: false, includeContext: false },
  })
  const engine = new ReviewEngine(config, audit, { enqueue() { return undefined } })
  const snapshot = await engine.prepareUnit(makeUnit('root8b', 'agent1', 'user', 'skip', false, false, false))
  assert.equal(snapshot.length, 0)
  assert.equal(getRootState('root8b').contextBuffer.length, 0)
})

test('prepareUnit triggers context_trim audit when over budget', async () => {
  deleteRootState('root9')
  const logged = []
  const engine = new ReviewEngine(Config({
    maxContextTokens: 100,
    contextTrimThreshold: 0.8,
    contextTrimTarget: 0.4,
    user: { review: false, block: false, includeContext: true },
  }), { log: async (entry) => { logged.push(entry) } }, { enqueue() { return undefined } })

  await engine.prepareUnit(makeUnit('root9', 'agent1', 'user', 'x'.repeat(120), false, false, true))
  await engine.prepareUnit(makeUnit('root9', 'agent1', 'user', 'x'.repeat(120), false, false, true))
  await engine.prepareUnit(makeUnit('root9', 'agent1', 'user', 'x'.repeat(120), false, false, true))

  assert.ok(logged.some((entry) => entry.action === 'context_trim'))
})

test('reviewBlockingExternal allows when user allows a blocked system', async () => {
  deleteRootState('root10')
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    system: { review: true, block: true, includeContext: true },
  })
  const interaction = {
    ask: async () => ({
      answers: [{ id: 'api-review-checkpoint', selected: ['全部允许'] }],
    }),
  }
  const fakeCtx = {
    agents: { get: () => ({ id: 'root10' }) },
    get: (name) => (name === 'userQuestions' ? interaction : undefined),
  }
  const engine = new ReviewEngine(config, audit, {
    enqueue(task) {
      if (task.sync) return Promise.resolve({ verdict: 'block', reason: 'bad system' })
      return undefined
    },
  })
  const unit = makeUnit('root10', 'agent1', 'system', 'evil system', true, true, true)

  const outcome = await engine.reviewBlockingExternal(fakeCtx, { id: 'agent1' }, unit, [], undefined)
  assert.equal(outcome.allow, true)
  assert.equal(getRootState('root10').frozen, false)
})

test('reviewBlocking rejects when sync scheduler returns no promise', async () => {
  deleteRootState('root11')
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    tool: { review: true, block: true, includeContext: true },
  })
  const fakeCtx = {
    agents: { get: () => undefined },
    get: () => undefined,
  }
  const engine = new ReviewEngine(config, audit, {
    enqueue() { return undefined },
  })
  const unit = makeUnit('root11', 'agent1', 'tool', 'bad', true, true, true)

  await assert.rejects(
    engine.reviewBlocking(fakeCtx, { id: 'agent1' }, unit),
    /did not return a promise/,
  )
})

test('reviewBlockingExternal rejects when sync scheduler returns no promise', async () => {
  deleteRootState('root12')
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    system: { review: true, block: true, includeContext: true },
  })
  const fakeCtx = {
    agents: { get: () => undefined },
    get: () => undefined,
  }
  const engine = new ReviewEngine(config, audit, {
    enqueue() { return undefined },
  })
  const unit = makeUnit('root12', 'agent1', 'system', 'bad', true, true, true)

  await assert.rejects(
    engine.reviewBlockingExternal(fakeCtx, { id: 'agent1' }, unit, [], undefined),
    /did not return a promise/,
  )
})

test('ensureRootExists and contextTokenCount work', async () => {
  deleteRootState('root13')
  const config = Config({
    user: { review: false, block: false, includeContext: true },
  })
  const engine = new ReviewEngine(config, audit, { enqueue() { return undefined } })
  await engine.ensureRootExists('root13')
  assert.ok(getRootState('root13'))
  await engine.prepareUnit(makeUnit('root13', 'agent1', 'user', 'abcd', false, false, true))
  assert.equal(await engine.contextTokenCount('root13'), 1)
})

test('async review truncates long pending block previews', async () => {
  deleteRootState('root20')
  const config = Config({
    tool: { review: true, block: false, includeContext: true },
  })
  const captured = []
  const engine = new ReviewEngine(config, audit, {
    enqueue(task) {
      captured.push(task)
      return undefined
    },
  })
  const unit = makeUnit('root20', 'agent1', 'tool', 'x'.repeat(200), true, false, true)
  await engine.reviewAsync(unit)
  await engine.handleAsyncResult(captured[0], { verdict: 'block', reason: 'long' })

  const state = getRootState('root20')
  assert.equal(state.pendingBlocks.length, 1)
  assert.ok(state.pendingBlocks[0].contentPreview.endsWith('…'))
})

test('reviewAsync with review=false does not enqueue', async () => {
  deleteRootState('root14')
  const config = Config({
    user: { review: false, block: false, includeContext: false },
  })
  let enqueued = false
  const engine = new ReviewEngine(config, audit, {
    enqueue() {
      enqueued = true
      return undefined
    },
  })
  await engine.reviewAsync(makeUnit('root14', 'agent1', 'user', 'x', false, false, false))
  assert.equal(enqueued, false)
})

test('reviewAsyncExternal with review=false does not enqueue', async () => {
  deleteRootState('root15')
  const config = Config({
    system: { review: false, block: false, includeContext: false },
  })
  let enqueued = false
  const engine = new ReviewEngine(config, audit, {
    enqueue() {
      enqueued = true
      return undefined
    },
  })
  await engine.reviewAsyncExternal(
    makeUnit('root15', 'agent1', 'system', 'x', false, false, false),
    [],
    undefined,
  )
  assert.equal(enqueued, false)
})

test('reviewBlockingExternal with review=false acts as a checkpoint only', async () => {
  deleteRootState('root16')
  const config = Config({
    system: { review: false, block: true, includeContext: false },
  })
  const engine = new ReviewEngine(config, audit, {
    enqueue() {
      throw new Error('should not enqueue')
    },
  })
  const unit = makeUnit('root16', 'agent1', 'system', 'system', false, true, false)
  const fakeCtx = {
    agents: { get: () => undefined },
    get: () => undefined,
  }

  const outcome = await engine.reviewBlockingExternal(fakeCtx, { id: 'agent1' }, unit, [], undefined)
  assert.equal(outcome.allow, true)
})

test('reviewBlocking with review=false and includeContext=false does not append context', async () => {
  deleteRootState('root17')
  const config = Config({
    tool: { review: false, block: true, includeContext: false },
  })
  const engine = new ReviewEngine(config, audit, {
    enqueue() {
      throw new Error('should not enqueue')
    },
  })
  const unit = makeUnit('root17', 'agent1', 'tool', 'checkpoint', false, true, false)
  const fakeCtx = {
    agents: { get: () => undefined },
    get: () => undefined,
  }

  const outcome = await engine.reviewBlocking(fakeCtx, { id: 'agent1' }, unit)
  assert.equal(outcome.allow, true)
  const state = getRootState('root17')
  assert.equal(state.contextBuffer.length, 0)
})

test('reviewBlocking returns deny when prior pending blocks are denied', async () => {
  deleteRootState('root18')
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    tool: { review: true, block: true, includeContext: true },
  })
  const state = getOrCreateRootState('root18')
  state.pendingBlocks = [{
    id: 'prior',
    rootSessionId: 'root18',
    agentId: 'agent1',
    unitId: 'u-prior',
    category: 'tool',
    reason: 'prior bad',
    contentPreview: 'prior bad',
    createdAt: Date.now(),
  }]
  const interaction = {
    ask: async () => ({
      answers: [{ id: 'api-review-checkpoint', selected: ['存在拒绝'] }],
    }),
  }
  const fakeCtx = {
    agents: { get: () => ({ id: 'root18' }) },
    get: (name) => (name === 'userQuestions' ? interaction : undefined),
  }
  const engine = new ReviewEngine(config, audit, {
    enqueue() {
      throw new Error('should not reach review')
    },
  })
  const unit = makeUnit('root18', 'agent1', 'tool', 'current', true, true, true)

  const outcome = await engine.reviewBlocking(fakeCtx, { id: 'agent1' }, unit)
  assert.equal(outcome.allow, false)
  assert.equal(getRootState('root18').frozen, true)
})

test('reviewBlockingExternal returns deny when prior pending blocks are denied', async () => {
  deleteRootState('root19')
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    system: { review: true, block: true, includeContext: true },
  })
  const state = getOrCreateRootState('root19')
  state.pendingBlocks = [{
    id: 'prior',
    rootSessionId: 'root19',
    agentId: 'agent1',
    unitId: 'u-prior',
    category: 'system',
    reason: 'prior bad',
    contentPreview: 'prior bad',
    createdAt: Date.now(),
  }]
  const interaction = {
    ask: async () => ({
      answers: [{ id: 'api-review-checkpoint', selected: ['存在拒绝'] }],
    }),
  }
  const fakeCtx = {
    agents: { get: () => ({ id: 'root19' }) },
    get: (name) => (name === 'userQuestions' ? interaction : undefined),
  }
  const engine = new ReviewEngine(config, audit, {
    enqueue() {
      throw new Error('should not reach review')
    },
  })
  const unit = makeUnit('root19', 'agent1', 'system', 'current', true, true, true)

  const outcome = await engine.reviewBlockingExternal(fakeCtx, { id: 'agent1' }, unit, [], undefined)
  assert.equal(outcome.allow, false)
  assert.equal(getRootState('root19').frozen, true)
})
