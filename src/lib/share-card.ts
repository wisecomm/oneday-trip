import { CATEGORY_COLOR, CATEGORY_LABEL, type Place } from './types'

/**
 * 방문 인증 카드 생성.
 *
 * Instagram 은 개인 계정에 대한 제3자 앱의 자동 게시를 허용하지 않는다.
 * (Graph API 의 콘텐츠 퍼블리싱은 Business/Creator 계정 + 앱 심사가 필요하고,
 *  개인 계정은 아예 대상이 아니다.)
 * 그래서 앱이 대신 올리는 대신, 바로 올릴 수 있는 이미지를 만들어 주고
 * OS 공유 시트로 넘긴다. 실제 게시 여부는 사용자가 결정한다.
 */

/** 인스타그램 피드 권장 비율 4:5 */
const W = 1080
const H = 1350

const FONT = `'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif`

/** 주어진 폭에 맞춰 줄바꿈한 텍스트 줄 배열을 만든다 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  // 한국어는 단어 경계가 공백과 일치하지 않는 경우가 많아 글자 단위로 재는 편이 안전하다
  for (const ch of text) {
    const next = current + ch
    if (ctx.measureText(next).width > maxWidth && current.length > 0) {
      lines.push(current)
      current = ch
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export interface VisitCardInput {
  place: Place
  tripTitle: string
  tripDate: string
  /** 타임라인에서 몇 번째 방문인지 */
  order: number
}

/** 방문 인증 카드를 PNG Blob 으로 만든다 */
export async function createVisitCard(input: VisitCardInput): Promise<Blob> {
  const { place, tripTitle, tripDate, order } = input
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context를 만들 수 없습니다')

  const accent = CATEGORY_COLOR[place.category]

  // 배경 — 카테고리 색에서 어두운 쪽으로 떨어지는 대각 그라디언트
  const bg = ctx.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, accent)
  bg.addColorStop(1, '#14171c')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 은은한 원형 하이라이트로 단조로움을 덜어 준다
  const glow = ctx.createRadialGradient(W * 0.78, H * 0.16, 0, W * 0.78, H * 0.16, W * 0.7)
  glow.addColorStop(0, 'rgba(255,255,255,0.20)')
  glow.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const pad = 96

  // 상단 브랜드
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = `800 40px ${FONT}`
  ctx.textBaseline = 'top'
  ctx.fillText('하루트립', pad, pad)

  // 카테고리 배지
  ctx.font = `700 32px ${FONT}`
  const badge = `${CATEGORY_LABEL[place.category]} · ${order}번째 방문`
  const badgeW = ctx.measureText(badge).width + 56
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  roundRect(ctx, pad, pad + 96, badgeW, 68, 34)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.fillText(badge, pad + 28, pad + 96 + 18)

  // 장소명 — 카드의 주인공
  ctx.fillStyle = '#ffffff'
  const nameSize = place.name.length > 12 ? 92 : 112
  ctx.font = `800 ${nameSize}px ${FONT}`
  const nameLines = wrapText(ctx, place.name, W - pad * 2)
  let y = H * 0.42
  for (const line of nameLines) {
    ctx.fillText(line, pad, y)
    y += nameSize * 1.18
  }

  // 한 줄 소개
  if (place.summary) {
    ctx.font = `500 38px ${FONT}`
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    y += 16
    for (const line of wrapText(ctx, place.summary, W - pad * 2).slice(0, 2)) {
      ctx.fillText(line, pad, y)
      y += 54
    }
  }

  // 하단 구분선
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pad, H - pad - 150)
  ctx.lineTo(W - pad, H - pad - 150)
  ctx.stroke()

  // 하단 여행 정보
  ctx.font = `700 36px ${FONT}`
  ctx.fillStyle = '#ffffff'
  ctx.fillText(tripTitle, pad, H - pad - 118)

  ctx.font = `500 32px ${FONT}`
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.fillText(`${tripDate} · ${place.region}`, pad, H - pad - 62)

  // 평점 (있을 때만)
  if (place.rating > 0) {
    ctx.font = `700 36px ${FONT}`
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'right'
    ctx.fillText(`★ ${place.rating.toFixed(1)}`, W - pad, H - pad - 118)
    ctx.textAlign = 'left'
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('이미지 생성에 실패했습니다'))),
      'image/png',
    )
  })
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
