import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const repositoryUrls = new Set([
  'https://github.com/jaissoncb/futebol.git',
  'https://github.com/jaissoncb/futebol',
  'git@github.com:jaissoncb/futebol.git',
  'ssh://git@github.com/jaissoncb/futebol.git',
])

export function gitAt(cwd) {
  return (...args) => execFileSync('git', args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  }).trim()
}

export function checkBase(git, candidate, { exact = false, log = console.log } = {}) {
  const base = git('rev-parse', '--verify', 'refs/remotes/origin/main^{commit}')
  const head = git('rev-parse', '--verify', `${candidate}^{commit}`)
  const [missing, ahead] = git('rev-list', '--left-right', '--count', `${base}...${head}`).split(/\s+/).map(Number)
  const status = git('status', '--porcelain=v1', '--untracked-files=normal')
  log(`origin/main ${base}\nCandidato ${head}\nCommits ausentes: ${missing}; exclusivos da branch: ${ahead}`)
  if (missing) log(git('log', '--oneline', '-12', `${head}..${base}`))
  if (status) log(status)
  if (missing || (exact && ahead) || status) {
    throw new Error('Preflight bloqueado. Preserve o trabalho e prepare uma branch limpa sobre a main atual antes de continuar.')
  }
}

function main() {
  const git = gitAt(process.cwd())
  const mode = process.argv[2]
  if (![undefined, '--release', '--pr'].includes(mode)) throw new Error('Modo de preflight invalido.')
  for (const args of [['--all'], ['--push', '--all']]) {
    const url = git('remote', 'get-url', ...args, 'origin')
    if (!repositoryUrls.has(url)) throw new Error('origin deve apontar exclusivamente para jaissoncb/futebol.')
  }
  console.log(`Raiz: ${git('rev-parse', '--show-toplevel')}\nBranch: ${git('rev-parse', '--abbrev-ref', 'HEAD')}`)
  git('fetch', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main')
  const candidate = mode === '--pr' ? process.env.FUTEBOL_PR_HEAD : 'HEAD'
  if (mode === '--pr' && !/^[a-f0-9]{40}$/.test(candidate ?? '')) throw new Error('SHA do PR invalido.')
  if (!mode && git('rev-parse', '--abbrev-ref', 'HEAD') === 'HEAD') throw new Error('Use uma branch de trabalho.')
  checkBase(git, candidate, { exact: mode === '--release' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main() }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
