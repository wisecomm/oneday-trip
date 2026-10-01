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
