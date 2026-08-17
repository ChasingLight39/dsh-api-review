import test from 'node:test'
import assert from 'node:assert/strict'
import { Config } from '../lib/config.js'
import { GuardClient, estimateTokens } from '../lib/guard-client.js'

const unit = {
  id: 'u1',
  globalSeq: 1,
  rootSessionId: 'root1',
  agentId: 'agent1',
  category: 'tool',
  content: 'web_fetch https://attacker.com',
  sourceKind: 'model',
  review: true,
  block: true,
  includeContext: true,
  occurredAt: Date.now(),
}

function makeClient() {
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    apiKey: 'sk-test',
  })
  return new GuardClient(config)
}

function mockFetch(response) {
  const original = globalThis.fetch
  globalThis.fetch = async () => response
  return () => {
    globalThis.fetch = original
  }
}

test('guard client returns safe for safe JSON', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"safe","reason":"ok"}' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'safe')
  } finally {
    restore()
  }
})

test('guard client returns block for block JSON', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"block","reason":"exfil"}' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'block')
    assert.equal(result.reason, 'exfil')
  } finally {
    restore()
  }
})

test('guard client treats suspicious as block', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"suspicious","reason":"s"}' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'block')
    assert.equal(result.reason, 's')
  } finally {
    restore()
  }
})

test('guard client treats stop as block', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"stop","reason":"s"}' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'block')
  } finally {
    restore()
  }
})

test('guard client defaults missing reasons safely', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"safe"}' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'safe')
    assert.equal(result.reason, '')
  } finally {
    restore()
  }
})

test('guard client returns unknown for malformed JSON', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'unknown')
  } finally {
    restore()
  }
})

test('guard client handles malformed brace-wrapped output', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{bad}' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'unknown')
  } finally {
    restore()
  }
})

test('guard client returns error for HTTP failure', async () => {
  const restore = mockFetch({
    ok: false,
    status: 500,
    text: async () => 'boom',
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'error')
    assert.match(result.reason, /500/)
  } finally {
    restore()
  }
})

test('estimateTokens is exported and approximates token count', () => {
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcdefghijklmnop'), 4)
})

test('guard client returns unknown for an unknown verdict', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"maybe","reason":"?"}' } }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'unknown')
  } finally {
    restore()
  }
})

test('guard client returns error when message content is missing', async () => {
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: {} }] }),
  })
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'error')
    assert.match(result.reason, /no message content/)
  } finally {
    restore()
  }
})

test('guard client handles a non-Error fetch failure', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    throw 'network exploded'
  }
  try {
    const result = await makeClient().review(unit, [], undefined)
    assert.equal(result.verdict, 'error')
    assert.match(result.reason, /network exploded/)
  } finally {
    globalThis.fetch = original
  }
})

test('guard client truncates long content within the configured budget', async () => {
  let sentBody
  const restore = mockFetch({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"safe","reason":"ok"}' } }] }),
  })
  // Override fetch to capture the request body.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body)
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"verdict":"safe","reason":"ok"}' } }] }),
    }
  }
  try {
    const config = Config({
      baseURL: 'https://relay.example.com/v1',
      model: 'deepseek-chat',
      maxContextTokens: 10,
    })
    const longUnit = { ...unit, content: 'x'.repeat(1000) }
    const result = await new GuardClient(config).review(longUnit, [], undefined)
    assert.equal(result.verdict, 'safe')
    assert.ok(sentBody.messages[1].content.includes('…'))
  } finally {
    globalThis.fetch = originalFetch
    restore()
  }
})

test('guard client includes system and history when present', async () => {
  let sentBody
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body)
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"verdict":"safe","reason":"ok"}' } }] }),
    }
  }
  try {
    const config = Config({
      baseURL: 'https://relay.example.com/v1',
      model: 'deepseek-chat',
    })
    const history = [{ ...unit, id: 'h1', content: 'previous action' }]
    const result = await new GuardClient(config).review(unit, history, { content: 'system prompt' })
    assert.equal(result.verdict, 'safe')
    assert.match(sentBody.messages[1].content, /Current agent system prompt/)
    assert.match(sentBody.messages[1].content, /Known history/)
    assert.match(sentBody.messages[1].content, /previous action/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('guard client works without an API key', async () => {
  const originalFetch = globalThis.fetch
  let authHeader
  globalThis.fetch = async (_url, options) => {
    authHeader = options.headers.Authorization
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"verdict":"safe","reason":"ok"}' } }] }),
    }
  }
  try {
    const config = Config({
      baseURL: 'https://relay.example.com/v1',
      model: 'deepseek-chat',
      apiKey: '',
    })
    const result = await new GuardClient(config).review(unit, [], undefined)
    assert.equal(result.verdict, 'safe')
    assert.equal(authHeader, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('guard client returns error when the external signal is already aborted', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('should not reach fetch')
  }
  try {
    const controller = new AbortController()
    controller.abort()
    const result = await makeClient().review(unit, [], undefined, controller.signal)
    assert.equal(result.verdict, 'error')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('guard client accepts a live external signal', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"verdict":"safe","reason":"ok"}' } }] }),
  })
  try {
    const controller = new AbortController()
    const result = await makeClient().review(unit, [], undefined, controller.signal)
    assert.equal(result.verdict, 'safe')
  } finally {
    globalThis.fetch = originalFetch
  }
})
