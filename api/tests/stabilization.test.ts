import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalJWKSet, generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createStabilizationValidation } from '../stabilization.ts'
import { g3Policy } from '../g3.ts'
import { AuthenticationError } from '../auth.ts'
import { HttpError } from '../server.ts'

void test('stabilization fresh and cached both require complete signed G3 and same bearer profile',async()=>{
  const keys=await generateKeyPair('RS256')
  const resolver=createLocalJWKSet({keys:[{...await exportJWK(keys.publicKey),kid:'stabilization-fixture',alg:'RS256'}]})
  const now=Math.floor(Date.now()/1000)
  const claims={iss:g3Policy.issuer,aud:g3Policy.audience,azp:g3Policy.clientId,sub:'synthetic-stabilization',amr:['pwd'],auth_time:now-30,iat:now,exp:now+600}
  const token=await new SignJWT(claims).setProtectedHeader({alg:'RS256',kid:'stabilization-fixture'}).sign(keys.privateKey)
  let calls=0
  const events:unknown[]=[]
  const validate=createStabilizationValidation(event=>events.push(event),(_url,options)=>{
    calls++;assert.equal(new Headers(options?.headers).get('authorization'),`Bearer ${token}`)
    return Promise.resolve(Response.json({sub:claims.sub}))
  },resolver)
  const url=(mode:string)=>new URL(`http://localhost:8787/__dev/stabilization?mode=${mode}&phase=sample`)
  await validate(`Bearer ${token}`,url('cached'));await validate(`Bearer ${token}`,url('cached'))
  assert.equal(calls,1)
  await validate(`Bearer ${token}`,url('fresh'));await validate(`Bearer ${token}`,url('fresh'))
  assert.equal(calls,3)
  await assert.rejects(validate(undefined,url('fresh')),AuthenticationError)
  assert.equal(calls,3)
  assert.throws(()=>validate(`Bearer ${token}`,url('bypass')),HttpError)
  assert.throws(()=>validate(`Bearer ${token}`,url('fresh_native')),HttpError)
  let nativeCalls=0
  const nativeValidate=createStabilizationValidation(event=>events.push(event),(_url,options)=>{
    calls++;assert.equal(new Headers(options?.headers).get('authorization'),`Bearer ${token}`)
    return Promise.resolve(Response.json({sub:claims.sub}))
  },resolver,(_url,options)=>{
    nativeCalls++;assert.equal(new Headers(options?.headers).get('authorization'),`Bearer ${token}`)
    return Promise.resolve(Response.json({sub:claims.sub}))
  })
  await nativeValidate(`Bearer ${token}`,url('fresh_native'))
  await nativeValidate(`Bearer ${token}`,url('fresh_native'))
  await nativeValidate(`Bearer ${token}`,url('cached'))
  await nativeValidate(`Bearer ${token}`,url('cached'))
  assert.equal(nativeCalls,3)
  await nativeValidate(`Bearer ${token}`,url('fresh'));assert.equal(calls,4)
  const invalid=await new SignJWT({...claims,amr:[]}).setProtectedHeader({alg:'RS256',kid:'stabilization-fixture'}).sign(keys.privateKey)
  await assert.rejects(nativeValidate(`Bearer ${invalid}`,url('fresh_native')),AuthenticationError)
  assert.equal(nativeCalls,3)
  assert.ok(!JSON.stringify(events).includes(token));assert.ok(!JSON.stringify(events).includes(claims.sub))
})
