import { get } from 'node:https'
import { Readable } from 'node:stream'
import { TLSSocket } from 'node:tls'
import { userinfoUrl } from './g3.ts'
import { transportCategory } from './transport-category.ts'

// Explicit transport comparison, NEVER a token/cache fallback. Fixed Test URL,
// verified TLS and one fresh socket per request; system networking is untouched.
export function createNativeUserinfoFetch(record:(event:Record<string,string|number|boolean>)=>void):typeof fetch {
  return (input,options) => new Promise<Response>((resolve,reject)=>{
    const authorization=new Headers(options?.headers).get('authorization')
    const address=typeof input==='string'?input:input instanceof URL?input.href:''
    if(address!==userinfoUrl||options?.method!=='GET'||options.redirect!=='error'
      ||options.credentials!=='omit'||!authorization?.startsWith('Bearer ')||!options.signal) {
      reject(new Error('invalid_native_userinfo_request'));return
    }
    const started=performance.now(),signal=options.signal
    if(signal.aborted){reject(new Error('userinfo_aborted'));return}
    const elapsed=()=>Math.round(performance.now()-started)
    let responseEnded=false,lastPhase='request'
    const request=get(userinfoUrl,{agent:false,rejectUnauthorized:true,
      headers:{Authorization:authorization,Accept:'application/json'}},response=>{
      lastPhase='headers'
      response.once('end',()=>{responseEnded=true;signal.removeEventListener('abort',abort)})
      record({event:'native_userinfo_transport',phase:'headers',elapsedMs:elapsed(),httpStatus:response.statusCode??0})
      const headers=new Headers()
      for(const key of ['content-type','content-length']) {
        const value=response.headers[key]
        if(typeof value==='string')headers.set(key,value)
      }
      try { resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>,{status:response.statusCode??502,headers})) }
      catch {response.destroy();reject(new Error('userinfo_response_unavailable'))}
    })
    const abort=()=>{if(!responseEnded)request.destroy(new Error('userinfo_aborted'))}
    signal.addEventListener('abort',abort,{once:true})
    request.once('close',()=>signal.removeEventListener('abort',abort))
    request.once('socket',socket=>{
      lastPhase='socket'
      socket.once('lookup',()=>{lastPhase='dns';record({event:'native_userinfo_transport',phase:'dns',elapsedMs:elapsed()})})
      socket.once('connect',()=>{lastPhase='tcp';record({event:'native_userinfo_transport',phase:'tcp',elapsedMs:elapsed()})})
      socket.once('secureConnect',()=>{lastPhase='tls';record({event:'native_userinfo_transport',phase:'tls',elapsedMs:elapsed(),certificateVerified:socket instanceof TLSSocket&&socket.authorized})})
    })
    request.once('error',error=>{
      if(responseEnded)return
      record({event:'native_userinfo_transport',phase:'error',lastPhase,elapsedMs:elapsed(),category:signal.aborted?'timeout':transportCategory(error)})
      reject(error)
    })
  })
}
