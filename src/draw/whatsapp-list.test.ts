import { describe, expect, it } from 'vitest'
import { players } from '../matches/test-fixtures'
import { matchWhatsAppName, parseWhatsAppCaptures } from './whatsapp-list'

describe('WhatsApp list', () => {
  it('reads 13 numbered names, two empty slots and excludes the waiting section', () => {
    const text = `Futebol de quinta
Quinta 12.11
20:00h - 21:00h
Min 10 jogadores, Max 15

1 - Ana
2 - Mário
3 - Bento
4 - Cecília
5 - Dora
6 - Ester
7 - folha seca
8 - Fábio
9 - Gilda
10 - Hugo
11 - Iara
12 - Joana
13 - Kellyvn
14 -
15 -

*Lista de espera*
16 - Milena
17 -`
    expect(parseWhatsAppCaptures([text])).toEqual({
      names: ['Ana', 'Mário', 'Bento', 'Cecília', 'Dora', 'Ester', 'folha seca', 'Fábio', 'Gilda', 'Hugo', 'Iara', 'Joana', 'Kellyvn'],
      emptySlots: 2,
    })
  })

  it('handles OCR numbering errors and skips numbered metadata', () => {
    expect(parseWhatsAppCaptures(['l. Ana\nO2 – Mário\n3 - Rua das Flores\n4 - 12.11\n5 - https://example.test\n6 - 5 €\n7 - 00000\n8 - Espera\n9 - Dora']).names).toEqual(['Ana', 'Mário'])
    expect(parseWhatsAppCaptures(['Continuação\n10 - Dora']).names).toEqual(['Dora'])
  })

  it('excludes a waiting-list continuation across overlapping captures', () => {
    expect(parseWhatsAppCaptures(['14 - Ana\n15 -\nEspera\n16 - Bento', '16 - Bento\n17 - Carla'])).toEqual({
      names: ['Ana'], emptySlots: 1,
    })
  })

  it('uses registered nicknames and leaves spelling variants and ties for review', () => {
    const roster = [
      { ...players[0]!, name: 'Fabiano', nickname: 'Folha Seca' },
      { ...players[1]!, name: 'Kellyvin' },
      { ...players[2]!, name: 'Mário' },
      { ...players[3]!, name: 'Mario' },
    ]
    expect(matchWhatsAppName('  FOLHA seca ', roster).safeId).toBe(roster[0]?.id)
    expect(matchWhatsAppName('Kellyvn', roster)).toEqual({ safeId: '', possible: [roster[1]] })
    expect(matchWhatsAppName('Mario', roster)).toEqual({ safeId: '', possible: roster.slice(2) })
    expect(matchWhatsAppName('Pessoa ausente', roster)).toEqual({ safeId: '', possible: [] })
  })
})
