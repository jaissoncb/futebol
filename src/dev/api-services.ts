import { createApiClient } from '../lib/api/client'
import { createFutebolApiServices } from '../lib/api/services'
import type { GroupWorkspaceData } from '../groups/group-service'

// Local diagnostics stay outside the public entry graph.
export function createDevApiServices(getAccessToken: () => Promise<string | null>, transport = fetch) {
  const services = createFutebolApiServices('http://localhost:8787', getAccessToken, transport)
  const diagnostics = createApiClient('http://localhost:8787', getAccessToken, transport)
  return { ...services,
    stabilizationRead: () => diagnostics.request<GroupWorkspaceData>('/workspace?__dev_delay=1'),
    close: () => { diagnostics.close(); services.close() },
  }
}
export type DevApiServices = ReturnType<typeof createDevApiServices>
