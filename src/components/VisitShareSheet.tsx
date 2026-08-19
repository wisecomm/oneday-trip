import { useEffect, useState } from 'react'
import {
  buildCaption,
  canShareFiles,
  createVisitCard,
  type VisitCardInput,
} from '@/lib/share-card'
import { BottomSheet } from './ui'

/**
 * 방문 인증 카드 공유 시트.
 *
 * 앱이 사용자를 대신해 인스타그램에 올리지는 않는다 — 개인 계정은 제3자 앱의
 * 자동 게시를 허용하지 않기 때문이다. 대신 바로 올릴 수 있는 이미지와 캡션을
 * 만들어 주고, 공유 시트를 여는 것까지가 앱의 역할이다.
 */
export function VisitShareSheet({
  input,
  onClose,
}: {
  input: VisitCardInput | null
  onClose: () => void
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!input) {
      setPreviewUrl(null)
      setFile(null)
      setError(null)
      return
    }
    let revoked: string | null = null
    let alive = true

    void createVisitCard(input)
      .then((blob) => {
        if (!alive) return
        const url = URL.createObjectURL(blob)
        revoked = url
        setPreviewUrl(url)
        setFile(new File([blob], `하루트립-${input.place.name}.png`, { type: 'image/png' }))
      })
      .catch((err) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : '카드를 만들지 못했습니다.')
      })

    return () => {
      alive = false
      // 미리보기 blob URL 은 시트를 닫을 때 반드시 회수한다
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [input])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  if (!input) return null

  const caption = buildCaption(input)

  async function share() {
    if (!file) return
    try {
      if (canShareFiles(file)) {
        // 모바일에서는 이 시트에 인스타그램이 함께 뜬다
        await navigator.share({ files: [file], text: caption })
        return
      }
      // 데스크톱 등 파일 공유를 지원하지 않는 환경 — 저장 + 캡션 복사로 안내
      download()
      await copyCaption()
      setToast('이미지를 저장하고 캡션을 복사했습니다. 인스타그램에 붙여 넣어 주세요.')
    } catch (err) {
      // 사용자가 공유를 취소한 경우는 오류가 아니다
      if (err instanceof DOMException && err.name === 'AbortError') return
      setToast('공유하지 못했습니다. 이미지 저장으로 시도해 주세요.')
    }
  }

  function download() {
    if (!previewUrl || !file) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = file.name
    a.click()
  }

  async function copyCaption() {
    await navigator.clipboard.writeText(caption)
  }

  return (
    <BottomSheet open onClose={onClose} title="방문 인증 카드">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-2xl bg-ink-100">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={`${input.place.name} 방문 인증 카드`}
                className="mx-auto block max-h-[42vh] w-auto"
              />
            ) : (
              <div className="flex h-56 items-center justify-center text-[13px] text-ink-400">
                카드를 만드는 중…
              </div>
            )}
          </div>

          <div>
            <p className="label">캡션</p>
            <p className="max-h-28 overflow-y-auto rounded-xl bg-ink-100 px-4 py-3 text-[13px] leading-relaxed whitespace-pre-line text-ink-700">
              {caption}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={share}
              disabled={!file}
              className="btn-primary flex-1"
            >
              공유하기
            </button>
            <button type="button" onClick={download} disabled={!file} className="btn-outline">
              이미지 저장
            </button>
            <button
              type="button"
              onClick={async () => {
                await copyCaption()
                setToast('캡션을 복사했습니다.')
              }}
              className="btn-outline"
            >
              캡션 복사
            </button>
          </div>

          <p className="hint">
            인스타그램은 외부 앱이 개인 계정에 대신 게시하는 것을 허용하지 않습니다. 공유하기를
            누르면 기기의 공유 시트가 열리고, 거기서 인스타그램을 선택해 올리시면 됩니다.
          </p>
        </div>
      )}

      {toast && (
        <p className="mt-3 rounded-xl bg-ink-800 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          {toast}
        </p>
      )}
    </BottomSheet>
  )
}
