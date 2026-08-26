import { useEffect, useRef, useState } from 'react'
import { buildCaption, canShareFiles, type VisitCardInput } from '@/lib/share-card'
import { BottomSheet } from './ui'

/** 인스타그램 캡션 상한 */
const CAPTION_LIMIT = 2200

/**
 * 방문 인증 공유 시트.
 *
 * 앱이 사용자를 대신해 인스타그램에 올리지는 않는다 — 개인 계정은 제3자 앱의
 * 자동 게시를 허용하지 않기 때문이다. 직접 찍은 사진과 캡션을 준비해 주고,
 * 공유 시트를 여는 것까지가 앱의 역할이다.
 */
export function VisitShareSheet({
  input,
  onClose,
}: {
  input: VisitCardInput | null
  onClose: () => void
}) {
  const [photo, setPhoto] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  // 시트가 닫히거나 대상이 바뀌면 사진과 문구를 초기화한다
  useEffect(() => {
    setPhoto(null)
    // 자동 생성 문구는 출발점일 뿐이다. 사용자가 자기 말로 고쳐 쓸 수 있어야 한다.
    if (input) setCaption(buildCaption(input))
  }, [input])

  // 미리보기 URL 은 사진이 바뀌거나 시트를 닫을 때 반드시 회수한다
  useEffect(() => {
    if (!photo) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(photo)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photo])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(id)
  }, [toast])

  if (!input) return null

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    // 같은 파일을 다시 골라도 change 가 발생하도록 값을 비워 둔다
    e.target.value = ''
    if (!selected) return
    if (!selected.type.startsWith('image/')) {
      setToast('이미지 파일만 사용할 수 있습니다.')
      return
    }
    setPhoto(selected)
  }

  async function share() {
    if (!photo) return
    try {
      if (canShareFiles(photo)) {
        // 모바일에서는 이 시트에 인스타그램이 함께 뜬다
        await navigator.share({ files: [photo], text: caption, title: input!.place.name })
        // 공유가 실제로 끝난 경우에만 닫는다 — 취소(AbortError)는 catch 에서 걸러진다
        onClose()
        return
      }
      // 데스크톱 등 파일 공유를 지원하지 않는 환경 — 저장과 캡션 복사로 대신한다
      if (previewUrl) {
        const a = document.createElement('a')
        a.href = previewUrl
        a.download = photo.name
        a.click()
      }
      await navigator.clipboard.writeText(caption).catch(() => {})
      setToast('사진을 저장하고 캡션을 복사했습니다. 인스타그램에 올려 주세요.')
    } catch (err) {
      // 사용자가 공유를 취소한 경우는 오류가 아니다
      if (err instanceof DOMException && err.name === 'AbortError') return
      setToast('공유하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }

  return (
    <BottomSheet open onClose={onClose} title="방문 인증">
      <div className="flex flex-col gap-4">
        {previewUrl ? (
          <div className="relative overflow-hidden rounded-2xl bg-ink-100">
            <img
              src={previewUrl}
              alt={`${input.place.name} 방문 사진`}
              className="mx-auto block max-h-[42vh] w-auto"
            />
            <button
              type="button"
              onClick={() => setPhoto(null)}
              className="absolute top-2 right-2 rounded-full bg-ink-900/70 px-3 py-1.5 text-[12px] font-bold text-white backdrop-blur"
            >
              사진 빼기
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink-200 bg-ink-50 px-6 py-10 transition-colors hover:border-brand-300 hover:bg-brand-50"
          >
            <span className="text-3xl" aria-hidden>
              📷
            </span>
            <span className="text-[14px] font-bold text-ink-700">
              {input.place.name}에서 찍은 사진 넣기
            </span>
            <span className="text-[12px] text-ink-500">탭해서 촬영하거나 앨범에서 선택하세요</span>
          </button>
        )}

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label className="label !mb-0" htmlFor="visit-caption">
              캡션
            </label>
            <div className="flex items-center gap-2">
              <span
                className={`text-[11.5px] font-semibold ${
                  caption.length > CAPTION_LIMIT ? 'text-red-500' : 'text-ink-400'
                }`}
              >
                {caption.length.toLocaleString()} / {CAPTION_LIMIT.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={() => setCaption(buildCaption(input!))}
                className="text-[12px] font-semibold text-brand-600"
              >
                기본 문구로
              </button>
            </div>
          </div>
          <textarea
            id="visit-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={5}
            placeholder="오늘 어땠는지 적어 보세요."
            className="field resize-y leading-relaxed"
          />
          {caption.length > CAPTION_LIMIT && (
            <p className="mt-1.5 text-[12px] font-semibold text-red-500">
              인스타그램 캡션은 {CAPTION_LIMIT.toLocaleString()}자를 넘을 수 없습니다.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          {photo && (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="btn-outline flex-1"
            >
              사진 변경
            </button>
          )}
          <button type="button" onClick={share} disabled={!photo} className="btn-primary flex-1">
            공유하기
          </button>
        </div>

        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          onChange={pickPhoto}
          className="hidden"
        />

        <p className="hint">
          인스타그램은 외부 앱이 개인 계정에 대신 게시하는 것을 허용하지 않습니다. 공유하기를
          누르면 기기의 공유 시트가 열리고, 거기서 인스타그램을 선택해 올리시면 됩니다.
        </p>
      </div>

      {toast && (
        <p className="mt-3 rounded-xl bg-ink-800 px-4 py-2.5 text-center text-[13px] font-semibold text-white">
          {toast}
        </p>
      )}
    </BottomSheet>
  )
}
