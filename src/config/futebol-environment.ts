export interface KindeConfiguration {
  domain: string
  clientId: string
  audience: string
  redirectUri: string
  logoutUri: string
}

export interface FutebolFrontendConfiguration {
  environment: 'dev' | 'prd'
  appOrigin: string
  apiBaseUrl: string
  identity: KindeConfiguration
}

function origin(value: unknown): string {
  if (typeof value !== 'string') throw new Error()
  const url = new URL(value)
  if (url.origin !== value || url.username || url.password) throw new Error()
  return value
}

/** Build-time public metadata only. Never read secrets or fall back across environments. */
export function validateFutebolEnvironment(input: unknown, environment: 'dev' | 'prd'): FutebolFrontendConfiguration {
  try {
    if (!input || typeof input !== 'object') throw new Error()
    const config = input as FutebolFrontendConfiguration
    if (config.environment !== environment || Object.keys(config).sort().join(',') !== 'apiBaseUrl,appOrigin,environment,identity') throw new Error()
    origin(config.appOrigin); origin(config.apiBaseUrl)
    const identity = config.identity
    if (!identity || Object.keys(identity).sort().join(',') !== 'audience,clientId,domain,logoutUri,redirectUri') throw new Error()
    origin(identity.domain)
    if (!identity.domain.startsWith('https://') || !/^[A-Za-z0-9_-]{10,100}$/.test(identity.clientId)
      || !/^urn:[a-zA-Z0-9:_-]{5,200}$/.test(identity.audience)
      || identity.redirectUri !== `${config.appOrigin}/` || identity.logoutUri !== `${config.appOrigin}/`) throw new Error()
    if (environment === 'dev') {
      if (config.appOrigin !== 'http://localhost:5173'
        || config.apiBaseUrl !== 'https://br-shiny-dust-bastckar-futebolapi.compute.c-8.eu-central-1.aws.neon.tech'
        || identity.domain !== 'https://sabara-test.eu.kinde.com'
        || identity.clientId !== 'ec7038eb3fba4f958013e0b36437caf1'
        || identity.audience !== 'urn:sabara:futebol:api:dev') throw new Error()
    } else if (config.appOrigin !== 'https://futebol.sabara.org'
      || !config.apiBaseUrl.startsWith('https://')
      || /localhost|127\.0\.0\.1|\[::1\]|(?:^|[.-])test(?:[.-]|$)|\.invalid$|\.example$|\.test$/.test(new URL(config.apiBaseUrl).hostname)
      || config.apiBaseUrl.includes('br-shiny-dust-bastckar')
      || identity.domain === 'https://sabara-test.eu.kinde.com'
      || identity.clientId === 'ec7038eb3fba4f958013e0b36437caf1'
      || identity.audience === 'urn:sabara:futebol:api:dev'
      || /(?:^|[.:-])(dev|test)(?:[.:-]|$)/i.test(`${identity.domain} ${identity.audience}`)) throw new Error()
    return config
  } catch {
    throw new Error(environment === 'prd'
      ? 'PRD bloqueado: exige contrato próprio aprovado de API e Kinde; nenhum fallback DEV/Test.'
      : 'Configuração pública Futebol DEV inválida.')
  }
}

export function assertFutebolLocation(url: URL, config: FutebolFrontendConfiguration) {
  if (url.origin !== config.appOrigin || url.pathname !== '/') throw new Error('Origem Futebol inválida.')
}
