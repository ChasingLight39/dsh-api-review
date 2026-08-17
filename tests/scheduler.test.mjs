import test from 'node:test'
import assert from 'node:assert/strict'
import { ReviewScheduler } from '../lib/scheduler.js'

function task(id, sync) {
  return {
    taskId: id,
    globalSeq: 0,
    rootSessionId: 'root1',
    agentId: 'agent1',
    unit: { id, category: 'tool', content: id },
    contextSnapshot: [],
    systemSnapshot: undefined,
    sync,
  }
}

test('ReviewScheduler processes strict FIFO and sync tasks wait', async () => {
  const order = []
  const guard = {
    async review(unit) {
      order.push(unit.id)
      return { verdict: 'safe', reason: '' }
    },
  }
  const scheduler = new ReviewScheduler(guard)

  scheduler.enqueue(task('a', false))
  scheduler.enqueue(task('b', false))
  const syncPromise = scheduler.enqueue(task('c', true))

  const result = await syncPromise
  assert.equal(result.verdict, 'safe')

  // Let the worker finish any trailing microtasks.
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.deepEqual(order, ['a', 'b', 'c'])
})

test('ReviewScheduler converts a guard throw into an error result', async () => {
  const guard = {
    async review() {
      throw new Error('guard boom')
    },
  }
  const scheduler = new ReviewScheduler(guard)
  const result = await scheduler.enqueue(task('x', true))
  assert.equal(result.verdict, 'error')
  assert.match(result.reason, /guard boom/)
})

test('ReviewScheduler stringifies a non-Error guard throw', async () => {
  const guard = {
    async review() {
      throw 'plain failure'
    },
  }
  const scheduler = new ReviewScheduler(guard)
  const result = await scheduler.enqueue(task('x', true))
  assert.equal(result.verdict, 'error')
  assert.match(result.reason, /plain failure/)
})

test('ReviewScheduler drops async tasks when the queue is full', async () => {
  const order = []
  let releaseFirst
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })
  const guard = {
    review(unit) {
      order.push(unit.id)
      if (unit.id === 'a') return firstGate
      return Promise.resolve({ verdict: 'safe', reason: '' })
    },
  }
  const handled = []
  const scheduler = new ReviewScheduler(guard, (task, result) => {
    handled.push({ taskId: task.taskId, result })
  }, 2)

  scheduler.enqueue(task('a', false)) // in flight
  scheduler.enqueue(task('b', false)) // queued
  scheduler.enqueue(task('c', false)) // queued
  scheduler.enqueue(task('d', false)) // dropped: queue already has b+c = max 2

  releaseFirst({ verdict: 'safe', reason: '' })
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(order, ['a', 'b', 'c'])
  const errors = handled.filter((entry) => entry.result.verdict === 'error')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].taskId, 'd')
  assert.ok(handled.some((entry) => entry.taskId === 'b'))
  assert.ok(handled.some((entry) => entry.taskId === 'c'))
})

test('ReviewScheduler rejects a sync task whose signal is already aborted', async () => {
  const guard = {
    async review() {
      return { verdict: 'safe', reason: '' }
    },
  }
  const scheduler = new ReviewScheduler(guard)
  const aborted = new AbortController()
  aborted.abort()
  const syncPromise = scheduler.enqueue({ ...task('aborted', true), signal: aborted.signal })
  await assert.rejects(syncPromise, /aborted/)
})

test('ReviewScheduler continues when an async result handler throws', async () => {
  const order = []
  const guard = {
    async review(unit) {
      order.push(unit.id)
      return { verdict: 'safe', reason: '' }
    },
  }
  const scheduler = new ReviewScheduler(guard, () => {
    throw new Error('handler boom')
  })

  scheduler.enqueue(task('a', false))
  const syncPromise = scheduler.enqueue(task('b', true))
  const result = await syncPromise
  assert.equal(result.verdict, 'safe')
  assert.deepEqual(order, ['a', 'b'])
})
