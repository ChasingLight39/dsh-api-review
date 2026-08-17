import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, validateConfig } from '../lib/config.js'

test('Config defaults match the agreed design', () => {
  const config = Config({})
  assert.equal(config.maxContextTokens, 256000)
  assert.equal(config.contextTrimThreshold, 0.8)
  assert.equal(config.contextTrimTarget, 0.4)
  assert.equal(config.timeoutMs, 8000)
  assert.equal(config.maxQueueSize, 1000)
  assert.equal(config.noUserAction, 'deny')
  assert.equal(config.recoveryText, '我已经更换了API源，我信任这个API，继续对话')
  for (const key of ['system', 'user', 'assistant', 'tool', 'toolResult', 'unmatched']) {
    assert.deepEqual(config[key], { review: false, block: false, includeContext: false })
  }
})

test('validateConfig fails when review is enabled without guard API', () => {
  const config = Config({
    tool: { review: true, block: true, includeContext: true },
  })
  assert.throws(() => validateConfig(config), /baseURL|model/)
})

test('validateConfig accepts a fully configured review setup', () => {
  const config = Config({
    baseURL: 'https://relay.example.com/v1',
    model: 'deepseek-chat',
    apiKey: 'sk-test',
    tool: { review: true, block: true, includeContext: true },
  })
  assert.doesNotThrow(() => validateConfig(config))
})

test('validateConfig rejects invalid trim target', () => {
  const config = Config({
    contextTrimThreshold: 0.4,
    contextTrimTarget: 0.5,
  })
  assert.throws(() => validateConfig(config), /contextTrimTarget/)
})

test('validateConfig rejects empty recovery text', () => {
  const config = Config({ recoveryText: '   ' })
  assert.throws(() => validateConfig(config), /recoveryText/)
})

test('validateConfig rejects invalid timeoutMs', () => {
  const config = Config({ timeoutMs: 0 })
  assert.throws(() => validateConfig(config), /timeoutMs/)
})

test('validateConfig rejects invalid maxContextTokens', () => {
  const config = Config({ maxContextTokens: 0 })
  assert.throws(() => validateConfig(config), /maxContextTokens/)
})

test('validateConfig rejects invalid contextTrimThreshold', () => {
  const config = Config({ contextTrimThreshold: 1.5 })
  assert.throws(() => validateConfig(config), /contextTrimThreshold/)
})

test('validateConfig rejects invalid maxQueueSize', () => {
  const config = Config({ maxQueueSize: 0 })
  assert.throws(() => validateConfig(config), /maxQueueSize/)
})
