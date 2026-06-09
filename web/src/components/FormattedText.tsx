import { formatText } from '../lib/format'

export function FormattedText({ text, className = '' }: { text: string; className?: string }) {
  if (!text) return null
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: formatText(text) }}
    />
  )
}
