/**
 * Root-scoped review state management.
 *
 * One RootReviewState is shared by every agent in the same root session tree.
 * All mutations to a root state go through withRootLock so parallel subagents
 * cannot corrupt shared context/pending/frozen state.
 */

import type { RootReviewState } from './types.ts'

const states = new Map<string, RootReviewState>()
const locks = new Map<string, Promise<void>>()

let globalSeq = 0

export function nextGlobalSeq(): number {
  globalSeq += 1
  return globalSeq
}

export function getOrCreateRootState(rootSessionId: string): RootReviewState {
  let state = states.get(rootSessionId)
  if (state === undefined) {
    state = {
      rootSessionId,
      contextBuffer: [],
      pendingBlocks: [],
      frozen: false,
      systemSnapshots: new Map(),
      checkpointLock: false,
      checkpointWaiters: [],
    }
    states.set(rootSessionId, state)
  }
  return state
}

export function getRootState(rootSessionId: string): RootReviewState | undefined {
  return states.get(rootSessionId)
}

export function deleteRootState(rootSessionId: string): void {
  states.delete(rootSessionId)
  locks.delete(rootSessionId)
}

export async function withRootLock<T>(rootSessionId: string, fn: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(rootSessionId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  locks.set(rootSessionId, previous.then(() => gate))
  try {
    return await previous.then(fn)
  } finally {
    release()
  }
}

export function liveRootIds(): string[] {
  return [...states.keys()]
}
