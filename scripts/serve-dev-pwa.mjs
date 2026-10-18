import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { createInterface } from 'node:readline'

// Controls only this own loopback static origin, never Windows networking.
// stdin: offline / online / quit. No access to Kinde/Neon credentials.
const root=resolve('dist-dev')
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'}
const server=createServer((request,response)=>{
  void(async()=>{
    const url=new URL(request.url,'http://localhost')
    const target=resolve(root,url.pathname==='/'?'index.html':`.${url.pathname}`)
    if(!target.startsWith(root+sep))throw new Error('path_denied')
    const body=await readFile(target)
    response.writeHead(200,{'Content-Type':types[extname(target)]??'application/octet-stream','Cache-Control':'no-store'})
    response.end(body)
  })().catch(()=>{response.writeHead(404);response.end()})
})
server.on('error',()=>{console.log('Futebol static DEV origin unavailable');process.exitCode=1})
const online=()=>{if(!server.listening)server.listen(5173,'localhost',()=>console.log('Futebol built DEV origin online localhost:5173'))}
const input=createInterface({input:process.stdin})
input.on('line',line=>{
  if(line==='offline'){server.closeAllConnections();server.close(()=>console.log('Futebol frontend origin offline; OS networking unchanged'))}
  if(line==='online')online()
  if(line==='quit'){server.closeAllConnections();server.close();input.close()}
})
online()
