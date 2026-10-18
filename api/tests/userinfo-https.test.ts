import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createNativeUserinfoFetch} from '../userinfo-https.ts'
import {userinfoUrl} from '../g3.ts'

void test('native comparison refuses arbitrary destination missing token or relaxed fetch options without connecting',async()=>{
  let events=0
  const transport=createNativeUserinfoFetch(()=>events++)
  const options={method:'GET',redirect:'error' as const,credentials:'omit' as const,signal:new AbortController().signal,headers:{Authorization:'Bearer synthetic-only'}}
  for(const [url,value] of [['https://other.invalid/',options],[userinfoUrl,{...options,headers:{}}],[userinfoUrl,{...options,redirect:'follow' as const}]]) {
    await assert.rejects(transport(url as string,value as RequestInit),/invalid_native_userinfo_request/)
  }
  assert.equal(events,0)
})
