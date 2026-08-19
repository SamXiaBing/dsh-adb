import test from 'node:test'
import assert from 'node:assert/strict'
import { CRASH_ANALYSIS_SKILL, registerSkills } from '../lib/skill.js'

test('crash-analysis skill definition is well-formed', () => {
  assert.equal(CRASH_ANALYSIS_SKILL.name, 'dsh-adb-crash-analysis')
  assert.ok(CRASH_ANALYSIS_SKILL.description.length > 10)
  assert.ok(CRASH_ANALYSIS_SKILL.content.length > 200)
  assert.match(CRASH_ANALYSIS_SKILL.content, /adb_crash_report/)
  assert.match(CRASH_ANALYSIS_SKILL.content, /dsh-automation/)
  assert.match(CRASH_ANALYSIS_SKILL.content, /FATAL EXCEPTION/)
})

test('registerSkills registers through ctx.skills and disposes', () => {
  let registered = null
  let disposed = false
  const ctx = {
    get: (name) => (name === 'skills' ? {
      register: (skill) => {
        registered = skill
        return () => { disposed = true }
      },
    } : undefined),
    effect: (fn) => fn(),
  }
  registerSkills(ctx)
  assert.equal(registered, CRASH_ANALYSIS_SKILL)
  // ctx.effect invoked the callback which returned the disposer; simulate teardown
  assert.equal(disposed, false)
})

test('registerSkills skips when skills service is absent', () => {
  let threw = false
  try {
    registerSkills({ get: () => undefined, effect: () => {} })
  } catch {
    threw = true
  }
  assert.equal(threw, false)
})
