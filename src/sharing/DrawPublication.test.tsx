import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api/client'
import type { FutebolDataClient } from '../lib/data-client'
import type { PublicationState } from './contracts'
import { DrawPublication } from './DrawPublication'

vi.mock('./draw-image', () => ({
  drawImage: () => Promise.resolve(new File(['fixture'], 'futebol-times.png', { type: 'image/png' })),
}))

const initial: PublicationState = {
  status: 'private', version: null, revision: 'a'.repeat(64), changed: false, options: null, publication: null,
  preview: {
    groupName: 'Futebol de Quinta', matchDate: '2026-11-26',
    teams: [{ name: 'Verde', color: 'green', players: [{ name: 'Cauê', reserve: false, goalkeeper: true }] }],
  },
}

function renderPublication() {
  const drawPublication = vi.fn().mockResolvedValue(initial)
  const updateDrawPublication = vi.fn()
  const client = { drawPublication, updateDrawPublication } as unknown as FutebolDataClient
  const user = userEvent.setup()
  render(<DrawPublication client={client} groupId="group" matchId="match" />)
  return { user, drawPublication, updateDrawPublication }
}

describe('publicação de sorteio pelo proprietário', () => {
  it('mostra prévia com divulgação opcional e usa o snapshot do servidor depois de publicar', async () => {
    const { user, drawPublication, updateDrawPublication } = renderPublication()
    expect(drawPublication).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Compartilhar sorteio' }))
    expect(await screen.findByText('Privado')).toBeVisible()
    expect(screen.getByText('Cauê')).toBeVisible()
    expect(screen.queryByText('Futebol de Quinta')).toBeNull()
    expect(screen.queryByText('26/11/2026')).toBeNull()
    expect(updateDrawPublication).not.toHaveBeenCalled()
    await user.click(screen.getByLabelText('Identificar goleiros'))
    await user.click(screen.getByLabelText('Incluir nome do grupo'))
    await user.selectOptions(screen.getByLabelText('Validade'), '7')
    expect(screen.getByText('Futebol de Quinta')).toBeVisible()
    expect(screen.getByText('Cauê (goleiro)')).toBeVisible()
    const options = { groupName: true, matchDate: false, goalkeepers: true }
    updateDrawPublication.mockResolvedValue({
      ...initial, status: 'published', version: 'b'.repeat(64), options,
      publication: {
        slug: 'futebol-de-quinta-a7r3t9', expiresAt: '2026-12-03T19:00:00Z',
        snapshot: { groupName: 'Futebol de Quinta', teams: initial.preview.teams },
      },
    })
    await user.click(screen.getByRole('button', { name: 'Publicar e compartilhar' }))
    expect(await screen.findByText('Publicado')).toBeVisible()
    expect(updateDrawPublication).toHaveBeenCalledExactlyOnceWith('group', 'match', {
      action: 'publish', options, days: 7, version: null, revision: initial.revision,
    })
    expect(screen.getByRole('link', { name: 'Abrir publicação' })).toHaveAttribute('href',
      expect.stringContaining('/s/?id=futebol-de-quinta-a7r3t9'))
    expect(screen.getByRole('button', { name: 'Salvar imagem' })).toBeEnabled()
  })

  it('reconsulta antes de tentar gravar novamente em caso de conflito', async () => {
    const { user, drawPublication, updateDrawPublication } = renderPublication()
    updateDrawPublication.mockRejectedValue(new ApiError(409))
    await user.click(screen.getByRole('button', { name: 'Compartilhar sorteio' }))
    await user.click(await screen.findByRole('button', { name: 'Publicar e compartilhar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Atualize o estado')
    const panel = within(screen.getByRole('region', { name: 'Publicação do sorteio' }))
    expect(panel.queryByRole('button', { name: 'Publicar e compartilhar' })).toBeNull()
    await user.click(panel.getByRole('button', { name: 'Atualizar publicação' }))
    expect(await screen.findByRole('button', { name: 'Publicar e compartilhar' })).toBeEnabled()
    expect(drawPublication).toHaveBeenCalledTimes(2)
    expect(updateDrawPublication).toHaveBeenCalledTimes(1)
  })
})
