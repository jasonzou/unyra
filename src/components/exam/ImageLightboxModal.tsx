import { X } from 'lucide-react'
import ModalScrim from '../ModalScrim'
import { useEscapeKey } from '../../lib/useEscape'
import HandwrittenImagePreview from './HandwrittenImagePreview'
import { t } from '../../i18n'

interface Props {
  src: string | null
  title?: string
  onClose: () => void
}

export default function ImageLightboxModal({ src, title = t('手写答案预览'), onClose }: Props) {
  useEscapeKey(() => {
    if (src) onClose()
  })

  if (!src) return null

  return (
    <ModalScrim z="z-[70]" onClose={onClose}>
      <div
        className="relative flex max-h-[92vh] max-w-[94vw] flex-col rounded-xl border border-line-strong bg-card p-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/60 pb-2 mb-2">
          <span className="text-[12.5px] font-semibold text-ink-strong">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft hover:bg-line/60 hover:text-ink transition"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-1 bg-paper/50 rounded-lg">
          <HandwrittenImagePreview
            src={src}
            alt={title}
            showZoomIcon={false}
            className="max-h-[80vh] max-w-full rounded object-contain"
          />
        </div>
      </div>
    </ModalScrim>
  )
}
