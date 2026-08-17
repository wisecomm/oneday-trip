import type { Place, Profile } from './types'

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

export interface Scored {
  place: Place
  score: number
  /** 왜 추천됐는지 사용자에게 보여줄 근거 라벨 */
  reasons: string[]
}

export function recommend(
  list: Place[],
  ctx: TripContext,
  profile: Profile | null,
  limit = 8,
): Scored[] {
  const scored = list.map((place) => {
    let score = place.rating * 2
    const reasons: string[] = []

    // 1) 취향 태그 일치 — 개인화 세그먼트
    const matched = profile?.taste_tags.filter((t) => place.tags.includes(t)) ?? []
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

    // 4) 주말이면 대기가 길어지므로, 대기 민감 사용자에게는 혼잡한 곳을 감점
    const isWeekend = ctx.weekday === 0 || ctx.weekday === 6
    const sensitivity = profile?.waiting_sensitivity ?? 3
    if (sensitivity <= 2 && place.waiting_count > 10) {
      score -= isWeekend ? 5 : 3
      reasons.push('대기 많음 · 성향상 비추천')
    } else if (sensitivity >= 4 && place.waiting_count > 10) {
      score += 1
      reasons.push('웨이팅 감수형 맛집')
    }

    return { place, score, reasons }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}
