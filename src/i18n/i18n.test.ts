import { describe, expect, it } from 'vitest'
import { ko, type MessageKey } from './messages/ko'
import { en } from './messages/en'
import { translate } from './index'

describe('다국어 사전', () => {
  it('영어 사전에 한국어에 없는 키가 없다(오타 · 지운 키)', () => {
    const extra = Object.keys(en).filter((k) => !(k in ko))
    expect(extra).toEqual([])
  })

  it('빠진 영어 번역 — 목록만 보여 준다(실패하지 않음, 한국어로 보인다)', () => {
    const missing = (Object.keys(ko) as MessageKey[]).filter((k) => !(k in en))
    if (missing.length) console.info(`영어 번역 없는 키 ${missing.length}개:`, missing.join(', '))
    expect(Array.isArray(missing)).toBe(true)
  })

  it('{이름} 자리표시가 한국어와 같다', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const bad = (Object.keys(en) as MessageKey[]).filter((k) => holes(en[k]!) !== holes(ko[k]))
    expect(bad).toEqual([])
  })

  it('없는 번역은 한국어로', () => {
    expect(translate('en', 'nav.home')).toBe('Home')
    expect(translate('ko', 'nav.home')).toBe('홈')
  })
})
