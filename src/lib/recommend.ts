import { shownRating, type Place, type PlaceCategory, type Profile } from './types'

/**
 * MAP-04-02 추천 엔진.
 * 시간 · 날씨 · 요일의 맥락(Context)과 회원 프로필(SYS-01-02) 취향 태그를 결합해
 * 장소 점수를 매긴다.
 */

export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow'

export interface TripContext {
  hour: number
  /** 0=일요일 */
  weekday: number
  weather: Weather
  temperature: number | null
}

const WEATHER_LABEL: Record<Weather, string> = {
  clear: '맑은',
  cloudy: '흐린',
  rain: '비 오는',
  snow: '눈 오는',
}

const WEEKDAY_LABEL = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

function timeSlotLabel(hour: number): string {
  if (hour < 6) return '새벽'
  if (hour < 11) return '아침'
  if (hour < 14) return '점심'
  if (hour < 17) return '오후'
  if (hour < 21) return '저녁'
  return '밤'
}

/** 예: '비 오는 일요일 오후, 성수동에서 가볼만한 곳' */
export function contextLabel(ctx: TripContext, region: string): string {
  return `${WEATHER_LABEL[ctx.weather]} ${WEEKDAY_LABEL[ctx.weekday]} ${timeSlotLabel(ctx.hour)}, ${region}에서 가볼만한 곳`
}

/** WMO weather code → 앱 내부 날씨 구분 */
function fromWmoCode(code: number): Weather {
  if (code === 0 || code === 1) return 'clear'
  if (code >= 71 && code <= 77) return 'snow'
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99))
    return 'rain'
  return 'cloudy'
}

/**
 * 실시간 날씨 조회 (Open-Meteo · 인증 키 불필요).
 * 실패 시 맑음으로 가정해 추천 피드가 끊기지 않도록 한다.
 */
export async function fetchWeather(lat: number, lng: number): Promise<Pick<TripContext, 'weather' | 'temperature'>> {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code`,
    )
    if (!res.ok) throw new Error(String(res.status))
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weather_code?: number }
    }
    return {
      weather: fromWmoCode(json.current?.weather_code ?? 3),
      temperature: json.current?.temperature_2m ?? null,
    }
  } catch {
    return { weather: 'clear', temperature: null }
  }
}

/**
 * 방문자 별점을 점수로 바꿀 때의 기준 (플로챠트/홈.md ❶ 의 rating_avg).
 *
 * 리뷰가 적은 장소는 평균을 PRIOR_MEAN 쪽으로 당긴다(베이지안 평균) — 한 사람이
 * 준 5점 하나로 순위 맨 위에 서지 못하게. PRIOR_WEIGHT 는 "가상의 보통 리뷰
 * 몇 건을 미리 깔아 두는가"다.
 *
 *   리뷰 1건 5점  → 보정 3.7 → +1.3
 *   리뷰 3건 5점  → 보정 4.2 → +2.4
 *   리뷰 10건 5점 → 보정 4.7 → +3.3   (시간대 맥락 +4 와 비슷한 크기)
 *   1점 쪽은 같은 크기로 깎는다.
 */
const RATING_PRIOR_MEAN = 3
const RATING_PRIOR_WEIGHT = 2
const RATING_SCORE_PER_STAR = 2

function ratingScore(place: Place): number {
  if (place.rating_avg == null || place.rating_count <= 0) return 0
  const n = place.rating_count
  const adjusted =
    (place.rating_avg * n + RATING_PRIOR_MEAN * RATING_PRIOR_WEIGHT) / (n + RATING_PRIOR_WEIGHT)
  return (adjusted - RATING_PRIOR_MEAN) * RATING_SCORE_PER_STAR
}

export interface Scored {
  place: Place
  score: number
  /** 왜 추천됐는지 사용자에게 보여줄 근거 라벨 */
  reasons: string[]
}

/** 점수를 매기고 순서를 정한 후보 — 동점 순서(tie)를 지녀 쪽을 나눠 꺼내도 순서가 흔들리지 않는다 */
export interface Ranked extends Scored {
  tie: number
}

/**
 * 장소 하나의 점수와 근거 라벨 — 추천 장소의 규칙 그 자체.
 *
 * **DB 함수 recommend_places(`20261016000000_recommend_places.sql`)가 같은 점수를 SQL 로 매긴다** —
 * 운영의 추천 장소는 서버가 고른 10곳에 이 함수로 근거 라벨만 다시 붙인다. 규칙을 바꾸면 두 곳을
 * 함께 바꾸고 플로챠트/추천.md 도 고친다.
 */
export function scorePlace(
  place: Place,
  ctx: Pick<TripContext, 'hour' | 'weather'>,
  tasteTags: string[],
): { score: number; reasons: string[] } {
  // 0) 방문자 별점. 리뷰 1~2건도 점수에는 들어가지만(작게), 근거 라벨은
  //    화면의 ★ 와 같은 기준(3건 이상)일 때만 단다 — 한 사람의 별점이 드러나지 않게.
  let score = ratingScore(place)
  const reasons: string[] = []
  const shown = shownRating(place)
  if (shown && shown.avg >= 4) reasons.push(`방문자 별점 ★${shown.avg.toFixed(1)}`)

  // 1) 취향 태그 일치 — 개인화 세그먼트
  const matched = tasteTags.filter((t) => place.tags.includes(t))
  if (matched.length > 0) {
    score += matched.length * 3
    reasons.push(`취향 태그 ${matched.join('·')}`)
  }

  // 2) 시간대 맥락
  const h = ctx.hour
  if (h >= 11 && h < 14 && place.category === 'babzip') {
    score += 4
    reasons.push('점심 시간대')
  }
  // 저녁 식사 — 없으면 맑은 저녁 추천이 술집 · 명소로만 채워져 밥집이 빠졌다
  if (h >= 17 && h < 21 && place.category === 'babzip') {
    score += 4
    reasons.push('저녁 시간대')
  }
  if (h >= 14 && h < 18 && place.category === 'cafe') {
    score += 4
    reasons.push('오후 카페 타임')
  }
  if (h >= 18 && place.category === 'sulzip') {
    score += 4
    reasons.push('저녁 술자리')
  }
  if (h >= 9 && h < 17 && place.category === 'spot') {
    score += 2
    reasons.push('낮 시간 관광')
  }

  // 3) 날씨 맥락 — 비/눈이면 실내를, 맑으면 야외를 우대
  if (ctx.weather === 'rain' || ctx.weather === 'snow') {
    if (place.category === 'cafe') {
      score += 4
      reasons.push(`${WEATHER_LABEL[ctx.weather]} 날 실내`)
    }
    if (place.category === 'spot') score -= 3
  } else if (ctx.weather === 'clear' && place.category === 'spot') {
    score += 3
    reasons.push('맑은 날 야외')
  }

  return { score, reasons }
}

/**
 * 동점 순서 — 씨앗(seed)과 장소 id 로 정해지는 0~1 값(FNV-1a). 같은 씨앗이면 늘 같은 순서라
 * '더 보기'로 쪽을 넘겨도 순서가 흔들리지 않고, 화면을 다시 열면 씨앗이 바뀌어 섞인다.
 * 데모 모드용 — 운영은 DB 함수가 md5(seed || id) 로 같은 일을 한다.
 */
export function tieHash(seed: string, id: string): number {
  let h = 0x811c9dc5
  for (const ch of seed + id) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 2 ** 32
}

/**
 * 후보 전부에 점수를 매겨 높은 순으로. 동점은 tieOf(장소 id) 순 — 없으면 무작위
 * (리뷰가 거의 없는 지금은 대부분 동점이라, 그대로 두면 가나다순 앞쪽만 뽑힌다).
 */
export function rankAll(
  list: Place[],
  ctx: TripContext,
  profile: Profile | null,
  tieOf?: (id: string) => number,
): Ranked[] {
  const tags = profile?.taste_tags ?? []
  return list
    .map((place) => ({
      place,
      ...scorePlace(place, ctx, tags),
      tie: tieOf ? tieOf(place.id) : Math.random(),
    }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
}

/**
 * 순서를 정한 후보(rankAll)에서 한 쪽(limit 곳)을 꺼낸다 — rest 는 남은 후보(순서 그대로),
 * '더 보기'가 다음 쪽을 여기서 꺼낸다.
 *
 * 한 종류가 쪽을 다 채우지 않게 — 시간대 · 날씨 가산이 종류 단위라, 맑은 저녁에는
 * 명소로만 쏠린다. 종류마다 limit 의 절반(10 이면 5곳)까지만 먼저 넣고, 다른 종류가
 * 모자라 자리가 남으면 점수순으로 마저 채운다. 쪽마다 같은 규칙.
 */
export function takePage(ranked: Ranked[], limit: number): { page: Ranked[]; rest: Ranked[] } {
  const cap = Math.ceil(limit / 2)
  const perCategory = new Map<PlaceCategory, number>()
  const picked = new Set<Ranked>()
  const skipped: Ranked[] = []
  for (const s of ranked) {
    if (picked.size >= limit) break
    const n = perCategory.get(s.place.category) ?? 0
    if (n < cap) {
      picked.add(s)
      perCategory.set(s.place.category, n + 1)
    } else {
      skipped.push(s)
    }
  }
  for (const s of skipped) {
    if (picked.size >= limit) break
    picked.add(s)
  }
  const page = [...picked].sort((a, b) => b.score - a.score || a.tie - b.tie)
  return { page, rest: ranked.filter((s) => !picked.has(s)) }
}

/** 점수 높은 limit 곳(종류 쏠림 제한 포함) — 추천 장소 첫 쪽 · 여행 자동 담기(recommendMix) */
export function recommend(
  list: Place[],
  ctx: TripContext,
  profile: Profile | null,
  limit = 8,
): Scored[] {
  return takePage(rankAll(list, ctx, profile), limit).page.map(({ place, score, reasons }) => ({
    place,
    score,
    reasons,
  }))
}

export interface CategoryQuota {
  category: PlaceCategory
  count: number
}

/**
 * 카테고리 비율을 정해 두고 그 안에서 점수순으로 고른다.
 * 순수 점수 랭킹만 쓰면(recommend) 카페 5곳처럼 한쪽으로 쏠릴 수 있어,
 * 여행 생성 직후 자동 담기(TripRulesPage)처럼 "골고루 구성"이 중요한 곳에 쓴다.
 * 특정 카테고리가 목표만큼 없으면, 부족한 만큼은 남은 곳 중 점수순으로 채운다.
 */
export function recommendMix(
  list: Place[],
  ctx: TripContext,
  profile: Profile | null,
  quota: CategoryQuota[],
): Place[] {
  const picked: Place[] = []
  const pickedIds = new Set<string>()

  for (const { category, count } of quota) {
    const subset = list.filter((p) => p.category === category)
    for (const { place } of recommend(subset, ctx, profile, count)) {
      picked.push(place)
      pickedIds.add(place.id)
    }
  }

  const target = quota.reduce((sum, q) => sum + q.count, 0)
  const shortfall = target - picked.length
  if (shortfall > 0) {
    const remaining = list.filter((p) => !pickedIds.has(p.id))
    for (const { place } of recommend(remaining, ctx, profile, shortfall)) {
      picked.push(place)
    }
  }

  return picked
}
