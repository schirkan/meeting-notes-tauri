import test from 'node:test'
import assert from 'node:assert/strict'
import { percentile, summarize, renderReport, STAGES, TARGET_P95_MS } from '../scripts/measure-latency-tauri.mjs'

test('percentile uses the nearest rank', () => {
  const values = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(values, 50), 50)
  assert.equal(percentile(values, 95), 95)
  assert.equal(percentile(values, 99), 99)
  assert.equal(percentile(values, 100), 100)
})

test('percentile handles empty input and single values', () => {
  assert.equal(percentile([], 95), null)
  assert.equal(percentile([42], 95), 42)
})

test('percentile does not depend on the input order', () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 50), 3)
  assert.equal(percentile([3, 2, 1], 95), 3)
})

test('summarize counts every stage and the end-to-end total', () => {
  const samples = Array.from({ length: 100 }, (_, i) => ({
    latency: {
      captureLatencyMs: 10,
      sidecarToPushMs: 2,
      azureToEventMs: 100 + i,
      pipeToEventMs: 5,
      totalMs: 117 + i
    }
  }))
  const summary = summarize(samples)
  assert.equal(summary.sampleCount, 100)
  for (const stage of STAGES) {
    assert.equal(summary.stages[stage.key].count, 100)
    assert.equal(typeof summary.stages[stage.key].p95, 'number')
  }
  assert.equal(summary.total.count, 100)
  assert.equal(summary.total.p50, 166)
  assert.equal(summary.total.p95, 211)
  assert.equal(summary.total.max, 216)
})

test('summarize ignores samples without latency values', () => {
  const summary = summarize([
    { latency: { totalMs: 100 } },
    { latency: {} },
    {},
    { latency: { totalMs: 300 } }
  ])
  assert.equal(summary.total.count, 2)
  assert.equal(summary.total.p50, 100)
  assert.equal(summary.total.p95, 300)
  assert.equal(summary.stages.captureLatencyMs.count, 0)
  assert.equal(summary.stages.captureLatencyMs.p50, null)
})

test('report marks the target as reached below the budget', () => {
  const summary = summarize([
    { latency: { captureLatencyMs: 10, sidecarToPushMs: 2, azureToEventMs: 100, pipeToEventMs: 5, totalMs: 117 } }
  ])
  const report = renderReport(summary, { generatedAt: '2026-01-01T00:00:00Z', source: 'Test' })
  assert.match(report, /ZIEL ERFUELLT/)
  assert.match(report, /P95 < 5000 ms/)
  assert.match(report, /End-to-End/)
})

test('report marks the target as missed above the budget', () => {
  const summary = summarize([
    { latency: { captureLatencyMs: 10, sidecarToPushMs: 2, azureToEventMs: 9000, pipeToEventMs: 5, totalMs: 9017 } }
  ])
  const report = renderReport(summary, { generatedAt: '2026-01-01T00:00:00Z', source: 'Test' })
  assert.match(report, /ZIEL NICHT ERFUELLT/)
  assert.ok(TARGET_P95_MS === 5000)
})
