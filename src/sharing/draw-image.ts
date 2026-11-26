import type { PublicLineup } from './contracts'
import { DRAW_TITLE, FUTEBOL_DOMAIN, lineupDate, playerCount, playerLabel, teamAccent } from './lineup'

const inset = 54
const background = '#f4f8f6'
const green = '#075b45'
const ink = '#14221d'
const muted = '#4b6258'
const font = 'system-ui, sans-serif'

type Paint = (context: CanvasRenderingContext2D) => void

function wrap(context: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/(\s+)/u)) {
    if (context.measureText(line + word).width <= maxWidth) {
      line += word
      continue
    }
    if (line.trim()) lines.push(line.trimEnd())
    line = word.trimStart()
    if (context.measureText(line).width <= maxWidth) continue
    const characters = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter().segment(line), item => item.segment)
      : Array.from(line)
    line = ''
    for (const character of characters) {
      if (context.measureText(line + character).width > maxWidth) {
        lines.push(line)
        line = ''
      }
      line += character
    }
  }
  return [...lines, line.trimEnd()]
}

export async function drawImage(snapshot: PublicLineup, link: string): Promise<File> {
  const canvas = document.createElement('canvas')
  const measure = canvas.getContext('2d')
  if (!measure) throw new Error('Imagem indisponível.')
  const total = snapshot.teams.reduce((sum, team) => sum + team.players.length, 0)
  const maxColumns = Math.min(7, 3 + Math.floor(total / 150))
  const width = 1200 + (maxColumns - 3) * 320
  const cardWidth = width - inset * 2
  const operations: Paint[] = []
  function fill(color: string, x: number, y: number, w: number, h: number) {
    operations.push(context => { context.fillStyle = color; context.fillRect(x, y, w, h) })
  }
  function text(value: string, x: number, y: number, w: number, size: number, color: string, weight = 500) {
    const style = `${weight} ${size}px ${font}`
    measure!.font = style
    const lines = wrap(measure!, value, w)
    const leading = Math.ceil(size * 1.32)
    operations.push(context => {
      context.font = style
      context.fillStyle = color
      for (const [index, line] of lines.entries()) context.fillText(line, x, y + index * leading)
    })
    return y + lines.length * leading
  }

  const header = operations.length
  let y = 48
  y = text('FUTEBOL', inset, y, cardWidth, 30, '#bcebd8', 800) + 12
  y = text(DRAW_TITLE, inset, y, cardWidth, 64, '#fff', 800)
  if (snapshot.groupName) y = text(snapshot.groupName, inset, y + 8, cardWidth, 36, '#fff', 650)
  const date = lineupDate(snapshot)
  if (date) y = text(date, inset, y + 6, cardWidth, 27, '#bcebd8', 600)
  y += 42
  const headerHeight = y
  operations.splice(header, 0, context => { context.fillStyle = green; context.fillRect(0, 0, width, headerHeight) })

  for (const team of snapshot.teams) {
    const top = y + 24
    const backgroundIndex = operations.length
    const left = inset + 30
    const innerWidth = cardWidth - 60
    y = text(`Time ${team.name}`, left, top + 26, innerWidth, 37, ink, 750)
    y = text(playerCount(team.players.length), left, y + 3, innerWidth, 24, muted, 650)
    for (const reserve of [false, true]) {
      const players = team.players.filter(player => player.reserve === reserve)
      if (!players.length) continue
      y = text(reserve ? 'Reservas' : 'Titulares', left, y + 14, innerWidth, 25, green, 750) + 8
      const columns = Math.min(maxColumns, Math.max(2, players.length))
      const gap = 24
      const columnWidth = (innerWidth - (columns - 1) * gap) / columns
      for (let i = 0; i < players.length; i += columns) {
        const topRow = y
        y = Math.max(...players.slice(i, i + columns).map((player, column) =>
          text(playerLabel(player), left + column * (columnWidth + gap), topRow, columnWidth, 27, ink),
        )) + 6
      }
    }
    y += 22
    const height = y - top
    const accent = teamAccent(team.color)
    operations.splice(backgroundIndex, 0, context => {
      context.fillStyle = '#fff'
      context.fillRect(inset, top, cardWidth, height)
      context.fillStyle = accent
      context.fillRect(inset, top, cardWidth, 7)
    })
  }

  const footer = y + 30
  fill('#dceee6', 0, footer, width, 2)
  y = text(FUTEBOL_DOMAIN, inset, footer + 26, cardWidth, 30, green, 800)
  y = text(link, inset, y + 3, cardWidth, 26, ink, 600) + 36
  const scale = Math.min(1, 8192 / y, Math.sqrt(15_000_000 / (width * y)))
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(y * scale)
  measure.scale(scale, scale)
  measure.textBaseline = 'top'
  measure.fillStyle = background
  measure.fillRect(0, 0, width, y)
  for (const paint of operations) paint(measure)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => {
    if (result) resolve(result)
    else reject(new Error('Não foi possível gerar a imagem.'))
  }, 'image/png'))
  return new File([blob], 'futebol-times.png', { type: 'image/png' })
}
