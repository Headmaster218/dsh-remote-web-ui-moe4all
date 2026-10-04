import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { Config } from '../lib/index.js'

test('third-party network services require explicit consent', () => {
  const defaults = Config({})
  assert.equal(defaults.autoTunnel, false)
  assert.equal(defaults.relay, false)
  assert.equal(defaults.telemetry, false)
  assert.equal(defaults.cookieName, 'moe4all_pair')
})

test('client bundle includes the official settings card and embedded styles', () => {
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(bundle, /ctx\.slots\.inject\("settings\.plugin\.item"/)
  assert.doesNotMatch(bundle, /ctx\.slots\.inject\("web-ui\.plugin\.item"/)
  assert.match(bundle, /tag\.dataset\.pluginCss = tagId/)
  assert.doesNotMatch(bundle, /__MOE4ALL_CSS__/)
})
