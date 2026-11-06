// PRD-only operator. Secrets stay in this process; commands/status contain no secrets.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {Client} from 'pg'
import {clientOptions,checkPreflight} from './neon-prd-preflight.mjs'
import {readSecretInput} from '../api/secret-input.ts'
import {readRuntimeConfig} from '../api/runtime-config.ts'
const project='withered-haze-60370136',branch='br-divine-sun-badnm7ch',role='futebol_api_prd_functions'
const base=`https://console.neon.tech/api/v2/projects/${project}/branches/${branch}`
const statusPath='.local-backup/neon-prd/live-release.json',commandPath='.local-backup/neon-prd/live-release-command.json'
let key,password,client,phase='input'
const runId=randomUUID()
async function report(status,extra={}){await writeFile(statusPath,JSON.stringify({runId,status,phase,...extra},null,2)+'\n')}
async function api(url,init={}){
 const r=await fetch(url,{...init,headers:{...init.headers,Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(30000)})
 if(!r.ok){void r.body?.cancel();throw Object.assign(new Error('management_request_failed'),{safeCode:`HTTP_${r.status}`})}
 return r
}
async function verify(){
 const sql=await readFile('deployment/neon-prd-verify-runtime.sql','utf8')
 for(const pooled of [false,true]){
  phase=pooled?'pooled_connect':'direct_connect'
  const cfg=clientOptions(password);cfg.user=role
  // PgBouncer rejects the preflight's startup options. SQL itself begins READ ONLY.
  cfg.options=undefined
  if(pooled)cfg.host=cfg.host.replace('.c-','-pooler.c-')
  cfg.ssl.servername=cfg.host
  client=new Client(cfg);client.on('error',()=>{})
  await client.connect()
  if(client.connection.stream.authorized!==true||client.connection.stream.servername!==cfg.host)throw new Error('tls_rejected')
  phase=pooled?'pooled_verify':'direct_verify'
  await client.query(sql);await client.end();client=undefined
 }
 await report('BANK_PASS',{direct:'PASS',pooled:'PASS',grantsRls:'PASS'})
}
async function functionStatus(){
 phase='function_status'
 const data=await (await api(`${base}/functions/futebolapi`)).json()
 const fn=data.function
 await report('FUNCTION_STATUS',{url:fn.invocation_url,latest:fn.current_deployment?.status,
   latestId:fn.current_deployment?.id,active:fn.active_deployment?.status,activeId:fn.active_deployment?.id,
   environmentNames:fn.current_deployment?.environment})
}
async function deploy(){
 phase='prepare_deployment'
 const config=JSON.parse(await readFile('deployment/neon-prd.runtime-config.json','utf8'))
 if(config.environment!=='prd'||config.allowedOrigin!=='https://futebol.sabara.org'||config.database.runtimeRole!==role)throw new Error('target_rejected')
 if(config.identity.issuer!=='https://login.sabara.org'||config.identity.audience!=='urn:sabara:futebol:api:prd'
 ||config.database.unpooledHost!=='ep-proud-mountain-bafo1u4d.c-8.eu-central-1.aws.neon.tech'
 ||config.database.pooledHost!=='ep-proud-mountain-bafo1u4d-pooler.c-8.eu-central-1.aws.neon.tech')throw new Error('target_rejected')
 for(const source of JSON.parse(await readFile('deployment/neon-dev.sources.json','utf8'))){
  if(createHash('sha256').update(await readFile(source.path)).digest('hex')!==source.sha256)throw new Error('source_integrity_rejected')
 }
 const dsn=host=>{const u=new URL(`postgresql://${host}/futebol_prd?sslmode=verify-full`);u.username=role;u.password=password;return u.href}
 const env={FUTEBOL_RUNTIME_CONFIG:JSON.stringify(config),DATABASE_URL:dsn(config.database.pooledHost),DATABASE_URL_UNPOOLED:dsn(config.database.unpooledHost)}
 readRuntimeConfig(env)
 const zip=await readFile('.local-backup/neon-functions-20261019/candidate-WRWZHz/function.zip')
 if(createHash('sha256').update(zip).digest('hex')!=='510bf79183fa4025d5ceb36849606b22cf845b4541d732888270cb98dc71202e')throw new Error('bundle_rejected')
 const body=new FormData();body.set('zip',new Blob([zip]),'function.zip');body.set('runtime','nodejs24');body.set('environment',JSON.stringify(env))
 phase='deployment_post_unknown_on_failure'
 const response=await api(`${base}/functions/futebolapi/deployments`,{method:'POST',body})
 void response.body?.cancel()
 await report('DEPLOY_ACCEPTED_CHECK_STATUS',{bundleSha256:'510bf79183fa4025d5ceb36849606b22cf845b4541d732888270cb98dc71202e'})
}
async function safeFailure(e){
 const code=e.safeCode??(/^[A-Z0-9_]{3,40}$/.test(e.code??'')?e.code:'UNCLASSIFIED')
 await report('STOPPED_AWAITING_COMMAND',{code,position:/^\d{1,6}$/.test(e.position??'')?Number(e.position):null})
 if(client){try{await client.end()}catch{}client=undefined}
}
try{
 await checkPreflight()
 const input=JSON.parse(await readSecretInput());key=input.apiKey;input.apiKey=null
 if(typeof key!=='string'||key.length<16)throw new Error('invalid_key')
 phase='retrieve_existing_runtime_password'
 const data=await (await api(`${base}/roles/${role}/reveal_password`)).json()
 password=data.password;data.password=null
 if(typeof password!=='string'||!password)throw new Error('password_unavailable')
 try{await verify()}catch(e){await safeFailure(e)}
 // Keep credentials only in memory while the owning task prepares public metadata.
 for(let n=0;n<3600;n++){
  let command
  try{command=JSON.parse(await readFile(commandPath,'utf8'))}catch{}
  if(command?.runId===runId && command.sequence!==globalThis.lastSequence){
   globalThis.lastSequence=command.sequence
   if(command.action==='stop')break
   try{if(command.action==='verify')await verify();else if(command.action==='deploy')await deploy();else if(command.action==='status')await functionStatus()}catch(e){await safeFailure(e)}
  }
  await new Promise(resolve=>setTimeout(resolve,1000))
 }
}catch(e){await safeFailure(e)}finally{
 key=null;password=null
 console.log(JSON.stringify({status:'session_ended_no_secrets_saved',runId}))
}
