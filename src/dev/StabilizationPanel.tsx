import { useEffect, useRef, useState } from 'react'
import { ApiError, createApiClient } from '../lib/api/client'

type Client = ReturnType<typeof createApiClient>
// DEV-only, user-triggered bounded measurements. Tokens remain in SDK memory.
export function StabilizationPanel({ active, getAccessToken, refreshEpoch, privateRead }: {
  active: boolean; getAccessToken: () => Promise<string | undefined>; refreshEpoch: number;
  privateRead?: () => Promise<unknown>
}) {
  const [status, setStatus] = useState('')
  const [audit, setAudit] = useState('')
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState({ visibleAt: 0, hiddenAt: 0 })
  const clients = useRef(new Set<Client>())
  useEffect(() => {
    const change = () => setFocus(previous => ({ ...previous,
      ...(document.visibilityState === 'visible' ? {visibleAt: Date.now()} : {hiddenAt: Date.now()}) }))
    document.addEventListener('visibilitychange',change)
    return () => document.removeEventListener('visibilitychange',change)
  }, [])
  useEffect(() => {
    const pending = clients.current
    if (!active) for (const client of pending) client.close()
    return () => { for (const client of pending) client.close(); pending.clear() }
  },[active])
  async function sample() {
    if (!active || busy) return
    const client = createApiClient('http://localhost:8787',async()=>await getAccessToken()??null)
    clients.current.add(client);setBusy(true)
    const results: {phase:string;httpStatus:number}[] = []
    const call = async (mode:string,phase:string) => {
      try { await client.request(`/__dev/stabilization?mode=${mode}&phase=${phase}`);results.push({phase,httpStatus:200}) }
      catch(error) { results.push({phase,httpStatus:error instanceof ApiError?error.status:0}) }
      if (!client.isClosed()) setStatus(JSON.stringify(results))
    }
    try {
      for(let i=0;i<6&&!client.isClosed();i++) await call('fresh','sample')
      if (!client.isClosed()) await call('cached','initial')
      if (!client.isClosed()) await call('cached','cache')
      if (!client.isClosed()) {
        await new Promise(resolve=>setTimeout(resolve,61000))
        if (!client.isClosed()) await call('cached','after_ttl')
      }
    } finally { client.close();clients.current.delete(client);setBusy(false) }
  }
  async function auditStorage() {
    const result = {workerControlsPage:Boolean(navigator.serviceWorker?.controller),cacheEntries:0,
      privateApiUrls:0,oauthQueryUrls:0,tokenLikeCacheValues:0,privateJsonObjects:0,
      persistedTokenKeys:0,persistedTokenLikeValues:0,oauthQueryInLocation:new URL(location.href).searchParams.has('code')||new URL(location.href).searchParams.has('state')}
    const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
    for(const storage of [localStorage,sessionStorage]) for(let i=0;i<storage.length;i++) {
      const key=storage.key(i)??''
      if(!key.startsWith('futebol-')) continue
      if(/(?:access|refresh|id)[_-]?token/i.test(key)) result.persistedTokenKeys++
      if(jwt.test(storage.getItem(key)??'')) result.persistedTokenLikeValues++
    }
    for(const name of await caches.keys()) {
      const cache=await caches.open(name)
      for(const request of await cache.keys()) {
        result.cacheEntries++
        const url=new URL(request.url)
        if(url.origin==='http://localhost:8787')result.privateApiUrls++
        if(url.searchParams.has('code')||url.searchParams.has('state'))result.oauthQueryUrls++
        const response=await cache.match(request)
        if(!response)continue
        const text=await response.text()
        if(jwt.test(text))result.tokenLikeCacheValues++
        if(/application\/json/i.test(response.headers.get('content-type')??'')) {
          try { const value:unknown=JSON.parse(text)
            if(value&&typeof value==='object'&&['groups','players','access_token','refresh_token'].some(key=>Object.hasOwn(value,key)))result.privateJsonObjects++
          } catch { /* Static non-JSON bodies are not exported. */ }
        }
      }
    }
    setAudit(JSON.stringify(result))
  }
  async function compareTransport() {
    if(!active||busy)return
    const client=createApiClient('http://localhost:8787',async()=>await getAccessToken()??null)
    clients.current.add(client);setBusy(true)
    const results:{mode:string;phase:string;httpStatus:number}[]=[]
    const cycle=async(phase:string,nativeFirst=false)=>{
      for(const mode of nativeFirst?['fresh_native','fresh','cached']:['fresh','fresh_native','cached']) {
        if(client.isClosed())return
        try {await client.request(`/__dev/stabilization?mode=${mode}&phase=${phase}`);results.push({mode,phase,httpStatus:200})}
        catch(error){results.push({mode,phase,httpStatus:error instanceof ApiError?error.status:0})}
        if(!client.isClosed())setStatus(JSON.stringify(results))
      }
    }
    try {
      await cycle('initial')
      if(!client.isClosed())await new Promise(resolve=>setTimeout(resolve,61000))
      if(!client.isClosed())await cycle('after_ttl',true)
      if(!client.isClosed())await new Promise(resolve=>setTimeout(resolve,61000))
      if(!client.isClosed())await cycle('after_ttl')
    } finally {client.close();clients.current.delete(client);setBusy(false)}
  }
  return <details><summary>Estabilização DEV</summary>
    <output aria-label="Eventos de sessão DEV">{JSON.stringify({refreshEpoch,...focus})}</output>
    <button disabled={!active||busy} onClick={()=>void sample()}>Medir disponibilidade DEV</button>
    <button disabled={!active||busy} onClick={()=>void compareTransport()}>Comparar transporte DEV</button>
    {privateRead?<button onClick={()=>{setStatus('Leitura privada pendente.');void privateRead().then(()=>setStatus('Leitura privada concluída.')).catch(()=>setStatus('Leitura privada cancelada ou indisponível.'))}}>Iniciar leitura privada demorada</button>:null}
    <button onClick={()=>void auditStorage()}>Verificar armazenamento DEV</button>
    <output aria-label="Resultados de disponibilidade DEV">{status}</output>
    <output aria-label="Auditoria de armazenamento DEV">{audit}</output>
  </details>
}
