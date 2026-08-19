import type { Place } from './types'

/**
 * 방문 인증 공유에 쓰는 유틸.
 *
 * Instagram 은 개인 계정에 대한 제3자 앱의 자동 게시를 허용하지 않는다.
 * (Graph API 의 콘텐츠 퍼블리싱은 Business/Creator 계정 + 앱 심사가 필요하고,
 *  개인 계정은 아예 대상이 아니다.)
 * 그래서 앱이 대신 올리는 대신, 사용자가 고른 사진과 캡션을 그대로 들고
 * OS 공유 시트를 여는 것까지가 앱의 역할이다.
 *
 * 사진은 가공하지 않고 원본 그대로 넘긴다. 재인코딩하면 화질만 떨어지고,
 * 자르기는 인스타그램 편집 화면에서 사용자가 직접 하는 편이 낫다.
 */

export interface VisitCardInput {
  place: Place
  tripTitle: string
  tripDate: string
  /** 타임라인에서 몇 번째 방문인지 */
  order: number
}

/** 인스타그램에 붙여 넣을 캡션 */
export function buildCaption(input: VisitCardInput): string {
  const { place, tripTitle, tripDate } = input
  const tags = ['하루트립', place.region.replace(/\s/g, ''), ...place.tags]
    .map((t) => `#${t.replace(/\s/g, '')}`)
    .join(' ')
  return `${place.name} 다녀왔어요.\n${place.summary}\n\n${tripTitle} · ${tripDate}\n${place.address}\n\n${tags}`
}

/** 이 브라우저가 이미지 파일 공유를 지원하는지 */
export function canShareFiles(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}
