export const neonDevTarget = Object.freeze({
  projectId: 'ancient-wildflower-55433050', branchId: 'br-shiny-dust-bastckar', branch: 'dev',
  database: 'futebol_dev', migrationRole: 'futebol_dev_owner',
  host: 'ep-small-voice-baiso0c9.c-8.eu-central-1.aws.neon.tech',
  pooledHost: 'ep-small-voice-baiso0c9-pooler.c-8.eu-central-1.aws.neon.tech',
})

export function validateNeonDevConnection(input: string): URL {
  try {
    if (input.length > 16384) throw new Error()
    const url = new URL(input)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || ![neonDevTarget.host, neonDevTarget.pooledHost].some(host => host === url.hostname)
      || url.port && url.port !== '5432' || url.pathname !== `/${neonDevTarget.database}`
      || decodeURIComponent(url.username) !== neonDevTarget.migrationRole || !url.password || url.hash
      || [...url.searchParams.keys()].some(key => !['sslmode', 'channel_binding'].includes(key))) throw new Error()
    url.searchParams.set('sslmode', 'verify-full')
    return url
  } catch { throw new Error('invalid_neon_dev_target') }
}
