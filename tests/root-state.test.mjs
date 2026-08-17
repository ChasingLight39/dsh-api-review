import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deleteRootState,
  getOrCreateRootState,
  getRootState,
  liveRootIds,
  nextGlobalSeq,
  withRootLock,
} from '../lib/root-state.js'

test('nextGlobalSeq increments monotonically', () => {
  const a = nextGlobalSeq()
  const b = nextGlobalSeq()
  assert.equal(b, a + 1)
})

test('getOrCreateRootState creates once and reuses', () => {
  deleteRootState('root-seq-1')
  const first = getOrCreateRootState('root-seq-1')
  const second = getOrCreateRootState('root-seq-1')
  assert.equal(first, second)
  assert.equal(getRootState('root-seq-1'), first)
})

test('deleteRootState removes state and lock entries', async () => {
  deleteRootState('root-seq-2')
  getOrCreateRootState('root-seq-2')
  await withRootLock('root-seq-2', () => undefined)
  assert.ok(liveRootIds().includes('root-seq-2'))
  deleteRootState('root-seq-2')
  assert.equal(getRootState('root-seq-2'), undefined)
  assert.ok(!liveRootIds().includes('root-seq-2'))
})

test('withRootLock serializes critical sections', async () => {
  deleteRootState('root-seq-3')
  const order = []
  await Promise.all([
    withRootLock('root-seq-3', async () => {
      order.push('a-start')
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push('a-end')
    }),
    withRootLock('root-seq-3', async () => {
      order.push('b-start')
      order.push('b-end')
    }),
  ])
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
})
