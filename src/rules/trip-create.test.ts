import { describe, expect, it } from 'vitest'
import type { Place, PlaceCategory } from '@/lib/types'
import {
  AUTO_ADD_QUOTA,
  autoTripTitle,
  buildDraft,
  checkStepOne,
  dedupeTitle,
  defaultTripDate,
  defaultTripTitle,
  isTitleEdited,
  planAutoAdd,
} from './trip-create'

/*
 * 플로챠트/여행-만들기.md 규칙 표를 그대로 옮긴 검사. 테스트 이름 앞의 [TC-…] 가 문서 ID 칸과 같다.
 */

describe('[TC-DATE] 기본 날짜 — 한국 날짜로 오늘 + 7일', () => {
  it('한국 시각 낮', () => {
    expect(defaultTripDate(new Date('2026-10-10T03:00:00Z'))).toBe('2026-10-17') // KST 10/10 12:00
  })
  it('한국 시각 새벽 1시 — UTC 로는 전날이어도 한국 날짜로 센다', () => {
    expect(defaultTripDate(new Date('2026-10-10T16:00:00Z'))).toBe('2026-10-18') // KST 10/11 01:00
  })
  it('월말 · 연말을 넘긴다', () => {
    expect(defaultTripDate(new Date('2026-10-28T03:00:00Z'))).toBe('2026-11-04')
    expect(defaultTripDate(new Date('2026-12-30T03:00:00Z'))).toBe('2027-01-06')
  })
})

describe('[TC-TITLE] 자동 제목', () => {
  it('시군구를 골랐으면 시군구 이름', () => {
    expect(defaultTripTitle('서울', '강남구', '2026-10-17')).toBe('강남구 당일치기 10-17')
  })
  it("시군구 '전체'면 시/도 이름", () => {
    expect(defaultTripTitle('서울', null, '2026-10-17')).toBe('서울 당일치기 10-17')
  })
})

describe('[TC-TITLE-DUP] 같은 제목이 있으면 -01, -02 …', () => {
  const base = '강남구 당일치기 10-17'
  it('겹치지 않으면 그대로', () => {
    expect(dedupeTitle(base, ['서울 당일치기 10-17'])).toBe(base)
  })
  it('하나 겹치면 -01', () => {
    expect(dedupeTitle(base, [base])).toBe(`${base}-01`)
  })
  it('-01 도 있으면 -02', () => {
    expect(dedupeTitle(base, [base, `${base}-01`])).toBe(`${base}-02`)
  })
  it('순번만 있고 원래 제목이 비었으면 원래 제목', () => {
    expect(dedupeTitle(base, [`${base}-01`])).toBe(base)
  })
  it('자동 제목은 중복 순번까지 붙인다', () => {
    expect(autoTripTitle('서울', '강남구', '2026-10-17', [base])).toBe(`${base}-01`)
  })
})

describe('[TC-TITLE-EDIT] 직접 고친 제목', () => {
  it('글자가 있으면 고친 것 — 목적지 · 날짜를 바꿔도 덮지 않는다', () => {
    expect(isTitleEdited('우리 가족 나들이')).toBe(true)
  })
  it('비우거나 공백만 남으면 다시 자동 제목', () => {
    expect(isTitleEdited('')).toBe(false)
    expect(isTitleEdited('   ')).toBe(false)
  })
})

describe('[TC-CHECK] 다음으로 넘어가기 전 검사', () => {
  it('제목이 비면', () => {
    expect(checkStepOne({ title: '  ', areaCode: 1 })).toBe('여행 제목을 입력해 주세요.')
  })
  it('목적지가 없으면', () => {
    expect(checkStepOne({ title: '서울 나들이', areaCode: null })).toBe('목적지를 골라 주세요.')
  })
  it('둘 다 있으면 통과', () => {
    expect(checkStepOne({ title: '서울 나들이', areaCode: 1 })).toBeNull()
  })
})

describe('[TC-DRAFT] 초안', () => {
  it('제목 공백을 지우고 09:00~20:00 · 시군구 null 은 시/도 전체', () => {
    expect(
      buildDraft({ title: '  서울 나들이 ', areaCode: 1, sigunguCode: null, tripDate: '2026-10-17', companions: ['friends'] }),
    ).toEqual({
      title: '서울 나들이',
      tour_area_code: 1,
      tour_sigungu_code: null,
      trip_date: '2026-10-17',
      start_time: '09:00',
      end_time: '20:00',
      companions: ['friends'],
    })
  })
})

/* ── 자동 담기 ── */

let seq = 0
function place(category: PlaceCategory, rating: number | null, count: number, lat: number, lng: number): Place {
  seq += 1
  return {
    id: `p${seq}`,
    name: `${category}-${seq}`,
    category,
    rating_avg: rating,
    rating_count: count,
    lat,
    lng,
    tags: [],
  } as unknown as Place
}

describe('[TC-SEED] 자동 담기 구성 — 밥집 2 · 카페 1 · 명소 4', () => {
  it('구성 상수', () => {
    expect(AUTO_ADD_QUOTA.map((q) => [q.category, q.count])).toEqual([
      ['babzip', 2],
      ['cafe', 1],
      ['spot', 4],
    ])
  })

  it('종류마다 별점 높은 곳을 정해진 수만큼', () => {
    const list = [
      place('babzip', 4.8, 10, 37.50, 127.00),
      place('babzip', 2.0, 10, 37.51, 127.01), // 별점 낮음 — 리뷰 없는 곳보다 뒤
      place('babzip', null, 0, 37.52, 127.02),
      place('cafe', 4.5, 5, 37.53, 127.03),
      place('cafe', null, 0, 37.54, 127.04),
      ...Array.from({ length: 6 }, (_, i) => place('spot', null, 0, 37.5 + i * 0.01, 127.05)),
      place('sulzip', 5, 20, 37.56, 127.06), // 술집은 구성에 없다
    ]
    const plan = planAutoAdd(list)
    const count = (c: PlaceCategory) => plan.filter((p) => p.category === c).length
    expect(plan).toHaveLength(7)
    expect([count('babzip'), count('cafe'), count('spot'), count('sulzip')]).toEqual([2, 1, 4, 0])
    expect(plan.map((p) => p.rating_avg)).toContain(4.8)
    expect(plan.map((p) => p.rating_avg)).not.toContain(2.0)
    expect(plan.find((p) => p.category === 'cafe')?.rating_avg).toBe(4.5)
  })

  it('한 종류가 모자라면 남은 곳에서 채워 7곳', () => {
    const list = [
      place('babzip', null, 0, 37.5, 127.0),
      place('babzip', null, 0, 37.51, 127.0),
      place('babzip', null, 0, 37.52, 127.0),
      place('cafe', null, 0, 37.53, 127.0),
      place('spot', null, 0, 37.54, 127.0), // 명소 1곳뿐
      place('sulzip', 4.9, 20, 37.55, 127.0),
      place('cafe', null, 0, 37.56, 127.0),
    ]
    const plan = planAutoAdd(list)
    expect(plan).toHaveLength(7)
    expect(new Set(plan.map((p) => p.id)).size).toBe(7)
  })

  it('장소가 없으면 빈 목록', () => {
    expect(planAutoAdd([])).toEqual([])
  })
})

describe('[TC-SEED-ORDER] 순서는 최단 동선 — 첫 장소(밥집 1위)가 출발점', () => {
  it('별점 1위 밥집에서 출발하고, 고른 곳을 빠짐없이 한 번씩', () => {
    const top = place('babzip', 5, 30, 37.50, 127.00)
    const list = [
      top,
      place('babzip', 4.0, 30, 37.60, 127.10),
      place('cafe', 4.0, 30, 37.51, 127.01),
      place('spot', 4.0, 30, 37.59, 127.09),
      place('spot', 4.0, 30, 37.52, 127.02),
      place('spot', 4.0, 30, 37.58, 127.08),
      place('spot', 4.0, 30, 37.53, 127.03),
    ]
    const plan = planAutoAdd(list)
    expect(plan[0].id).toBe(top.id)
    expect(new Set(plan.map((p) => p.id))).toEqual(new Set(list.map((p) => p.id)))
    // 가까운 곳(37.5x)을 먼저 돌고 먼 곳(37.6 쪽)으로 — 오가며 지그재그하지 않는다
    const lats = plan.map((p) => p.lat)
    expect(lats.slice(0, 4).every((v) => v < 37.55)).toBe(true)
  })
})
