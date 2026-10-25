function scrollTo(element: Element | null) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
}

export const scrollToId = (id: string) => scrollTo(document.getElementById(id))
/** Findings that share a passage are shown as one entry that lists every id it covers. */
export const scrollToFinding = (key: string) => scrollTo(document.querySelector(`[data-finding-ids~="${CSS.escape(key)}"]`))
/** A finding can be split across segments or overlap another, so the first element marking it is used. */
export const scrollToMark = (key: string) => scrollTo(document.querySelector(`[data-marks~="${CSS.escape(key)}"]`))

/** Keep a row visible inside a scrolling list without moving the page. */
export function keepVisible(container: HTMLElement, row: HTMLElement) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const top = row.offsetTop
  const bottom = top + row.offsetHeight
  if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
    container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: reduce ? 'auto' : 'smooth' })
  }
}
