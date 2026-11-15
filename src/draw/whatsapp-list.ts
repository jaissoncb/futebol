import type { Player } from '../groups/group-service'

export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

const waitingHeading = /^(?:(?:lista|fila)\s+de\s+)?espera\b/i

function parseWhatsAppList(text: string) {
  const entries: { number: number; name: string }[] = []
  let waitingAfter: number | null = null
  let lastNumber = 0
  let emptySlots = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[*_~]+|[*_~]+$/g, '').trim()
    if (waitingHeading.test(line)) { waitingAfter = lastNumber || null; break }
    const numbered = /^([0-9IlO]{1,3})\s*[-–—.):]\s*(.*)$/u.exec(line)
    if (!numbered) continue
    const number = Number(numbered[1]?.replace(/[Il]/g, '1').replace(/O/g, '0'))
    const name = (numbered[2] ?? '').replace(/^[*_~\s]+|[*_~\s]+$/g, '')
    if (waitingHeading.test(name)) { waitingAfter = lastNumber || null; break }
    lastNumber = Math.max(lastNumber, number)
    if (!name) { emptySlots++; continue }
    if (name.length > 100 ||
        !/^\p{L}[\p{L}\p{M} .'’-]*$/u.test(name) ||
        /^(?:rua|avenida|alameda|estrada|endereço|min|max|local|data|horário|valor|preço)\b/i.test(name)) continue
    entries.push({ number, name })
  }
  return { entries, emptySlots, waitingAfter }
}

export function parseWhatsAppCaptures(sources: string[]) {
  const lists = sources.map(parseWhatsAppList)
  const lastRegularNumber = Math.min(...lists.flatMap(({ waitingAfter }) => waitingAfter === null ? [] : [waitingAfter]))
  const names = lists.flatMap(({ entries }) => entries
    .filter(({ number }) => number <= lastRegularNumber)
    .map(({ name }) => name))
  return { names, emptySlots: Math.max(0, ...lists.map((list) => list.emptySlots)) }
}

function oneEditApart(a: string, b: string) {
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  let index = 0
  while (index < shorter.length && shorter[index] === longer[index]) index++
  return shorter.slice(index + (a.length === b.length ? 1 : 0)) === longer.slice(index + 1)
}

export function matchWhatsAppName(name: string, players: Player[]) {
  const normalized = normalizeName(name)
  if (!normalized) return { safeId: '', possible: [] }
  const keys = (player: Player) => [normalizeName(player.name), normalizeName(player.nickname ?? '')]
  const exact = players.filter((player) => keys(player).includes(normalized))
  if (exact.length === 1 && exact[0]) return { safeId: exact[0].id, possible: [] }
  const possible = exact.length > 1 ? exact : players.filter((player) =>
    keys(player).some((key) => key.split(' ').includes(normalized) || oneEditApart(key, normalized)))
  return { safeId: '', possible }
}
