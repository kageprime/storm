export function formatText(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // `` inline code ``
  html = html.replace(/`([^`]+)`/g, '<code class="text-[11px] bg-storm-bg/80 px-1 py-0.5 rounded font-mono text-storm-accent">$1</code>')

  // **bold**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')

  // URLs
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-storm-accent underline decoration-storm-accent/30 hover:decoration-storm-accent/60">$1</a>'
  )

  // Line breaks → paragraphs
  const parts = html.split(/\n\n+/)
  if (parts.length > 1) {
    html = parts.map((p) => p.trim()).filter(Boolean).map((p) => `<p class="mb-1 last:mb-0">${p}</p>`).join('')
  } else {
    html = html.replace(/\n/g, '<br/>')
  }

  return html
}
