import { lookup, resolve4, resolve6 } from 'node:dns/promises'
import { connect } from 'node:tls'
import { get } from 'node:https'
import { writeFileSync } from 'node:fs'
import { transportCategory } from '../api/transport-category.ts'

// Four samples, fixed public Test JWKS only: no credentials, IP logging or OS changes.
const host = 'sabara-test.eu.kinde.com'
const url = `https://${host}/.well-known/jwks`
const observations: Record<string,string|number|boolean>[] = []
const timed = async (sample:number, stage:string, work:()=>Promise<Record<string,string|number|boolean>>) => {
  const started = performance.now()
  try { const result=await work(); observations.push({sample,stage,status:'PASS',elapsedMs:Math.round(performance.now()-started),...result}) }
  catch(error) { observations.push({sample,stage,status:'FAIL',elapsedMs:Math.round(performance.now()-started),category:transportCategory(error)}) }
}
const deadline = <T>(work:Promise<T>) => {
  let timer:ReturnType<typeof setTimeout>
  return Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('bounded_timeout'),{code:'ETIMEDOUT'})),5000)})])
    .finally(()=>clearTimeout(timer))
}
for(let sample=1;sample<=4;sample++) {
  await timed(sample,'os_dns',async()=>({addresses:(await deadline(lookup(host,{all:true}))).length}))
  await timed(sample,'dns_a',async()=>({addresses:(await deadline(resolve4(host))).length}))
  await timed(sample,'dns_aaaa',async()=>({addresses:(await deadline(resolve6(host))).length}))
  await timed(sample,'tls',()=>new Promise((resolve,reject)=>{
    const socket=connect({host,port:443,servername:host,rejectUnauthorized:true})
    socket.setTimeout(5000,()=>socket.destroy(Object.assign(new Error('bounded_timeout'),{code:'ETIMEDOUT'})))
    socket.once('error',reject)
    socket.once('secureConnect',()=>{resolve({certificateVerified:socket.authorized});socket.end()})
  }))
  await timed(sample,'native_https_jwks',()=>new Promise((resolve,reject)=>{
    const started=performance.now()
    let dnsMs=0,tcpMs=0,tlsMs=0
    const request=get(url,{rejectUnauthorized:true},response=>{
      let bytes=0
      response.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536)request.destroy(new Error('body_limit'))})
      response.once('end',()=>resolve({httpStatus:response.statusCode??0,dnsMs,tcpMs,tlsMs}))
      response.once('error',reject)
    })
    const timer=setTimeout(()=>request.destroy(Object.assign(new Error('bounded_timeout'),{code:'ETIMEDOUT'})),5000)
    request.once('socket',socket=>{
      socket.once('lookup',()=>{dnsMs=Math.round(performance.now()-started)})
      socket.once('connect',()=>{tcpMs=Math.round(performance.now()-started)})
      socket.once('secureConnect',()=>{tlsMs=Math.round(performance.now()-started)})
    })
    request.once('close',()=>clearTimeout(timer));request.once('error',reject)
  }))
  await timed(sample,'node_fetch_jwks',async()=>{
    const response=await fetch(url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000)})
    await response.body?.cancel()
    return {httpStatus:response.status}
  })
}
writeFileSync('D:/Projetos/_Handoff/Futebol/FUTEBOL_B1_REDE_2026-10-18.json',JSON.stringify({
  at:new Date().toISOString(),source:'fixed_public_test_jwks_no_credentials',samples:4,observations,
},null,2))
console.log(JSON.stringify({samples:4,observations:observations.length,failures:observations.filter(item=>item.status==='FAIL').length}))
