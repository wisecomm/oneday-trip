/**
 * 여행 날짜 표기.
 *
 * `TripCreatePage` 안에 있던 것을 떼어 냈다. 홈·여행 목록·타임라인·추천이 전부
 * 그 화면에서 이 함수 하나를 가져다 쓰는 바람에, 화면을 동적 import 로 나눠도
 * `TripCreatePage` 가 첫 화면 번들에 그대로 끌려 들어왔다 (vite 경고:
 * "dynamic import will not move module into another chunk").
 *
 * 여러 화면이 같이 쓰는 것은 화면이 아니라 lib 에 둔다.
 */

/** 날짜를 '8월 24일 (월)' 형태로 표기 */
export function formatTripDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`
}

/** 날짜를 'MM-DD' 형태로 표기 — 제목 끝에 붙는 짧은 표기 */
export function formatMonthDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 한국 날짜 'YYYY-MM-DD' — 오늘에서 offsetDays 만큼 뒤(음수면 앞).
 *
 * 예전에는 화면마다 `new Date()` 에 날을 더하고 `toISOString().slice(0, 10)` 을 썼는데, 그건 UTC 날짜라
 * 한국 시각 0~9시에는 하루 앞 날짜가 나왔다 — 새벽에 새 여행을 만들면 기본 날짜가 +7일이 아니라 +6일,
 * '다가오는 여행'에 어제 여행이 끼었다(10/10 고침). 여행지가 한국이라 기기 시간대와 상관없이 한국 날짜로 센다.
 */
export function kstDate(offsetDays = 0, now: Date = new Date()): string {
  // en-CA 는 'YYYY-MM-DD' 로 찍는다
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  if (offsetDays === 0) return today
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10)
}

/** 오늘(한국 날짜) 이후 가장 빠른 여행 — 없으면 null. 오늘 여행도 다가오는 여행이다 */
export function upcomingTrip<T extends { trip_date: string }>(trips: T[], today = kstDate()): T | null {
  return (
    trips
      .filter((t) => t.trip_date >= today)
      .sort((a, b) => a.trip_date.localeCompare(b.trip_date))[0] ?? null
  )
}
