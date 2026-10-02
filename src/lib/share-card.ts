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

/**
 * 해시태그로 쓸 수 있는 글자만 남긴다.
 *
 * 공백만 지우던 때는 이름에 섞인 구두점이 그대로 나갔다. 인스타그램은
 * 해시태그를 글자·숫자·밑줄까지만 읽으므로, `#간송미술관(서울보화각)` 은
 * `#간송미술관` 까지만 태그가 되고 나머지는 본문 글자로 남는다. 지역 이름도
 * 마찬가지다 — '제물포·영종(옛 중구)' 의 가운뎃점에서 끊긴다.
 *
 * 괄호 안은 아예 뺀다. '(옛 중구)' 같은 부연은 태그로서 뜻이 없고, 붙여 쓰면
 * '제물포영종옛중구' 처럼 아무도 검색하지 않을 말이 된다.
 */
const hashtag = (s: string): string =>
  '#' + s.replace(/\([^)]*\)/g, '').replace(/[^0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ_]/gu, '')

/** 인스타그램에 붙여 넣을 캡션 */
export function buildCaption(input: VisitCardInput): string {
  const { place, tripTitle, tripDate } = input
  // 지역은 코드가 아니라 이름이다 — 조회할 때 조인해 채워진 값을 쓴다.
  // 여기서 코드를 쓰면 사용자 게시물에 '#-1' 같은 게 나간다.
  const tags = [
    '하루여행',
    place.name,
    `${place.group_name}${place.region_name}`,
    ...place.tags,
  ]
    .map(hashtag)
    .filter((t) => t.length > 1)
    .join(' ')
  return `${place.name} 다녀왔어요.\n${place.summary}\n\n${tripTitle} · ${tripDate}\n${place.address}\n\n${tags}`
}

/** 이 브라우저가 이미지 파일 공유를 지원하는지 */
export function canShareFiles(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
}
