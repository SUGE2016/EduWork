// Native qualification without exposing the application's debugging endpoint.
import {createRequire} from 'node:module'
import {readFile,writeFile,mkdir,readdir,link,copyFile,stat,unlink,cp,symlink} from 'node:fs/promises'
import {resolve,join,dirname} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {spawn,execFileSync} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {renderBrowser,pageBrowser} from '../dsh-plugins/desktop-services/lib/browser-provider.js'
import {prepareComposition,renderComposition,renderFrame} from '../packages/dsh-knowledge-studio/packages/artifact-services/lib/remotion.js'
const [appPath,evidencePath]=process.argv.slice(2)
if(!appPath||!evidencePath)throw Error('Usage: node scripts/probe-electron-browser-reuse.mjs <assembled-app> <new-evidence-directory>')
const application=resolve(appPath),root=resolve(evidencePath),runtime=join(application,'resources/product/d')
const require=createRequire(join(runtime,'package.json')), {chromium}=require('playwright-core'),WS=require('ws')
assert.match(await readFile(join(runtime,'node_modules/@eduwork/dsh-knowledge-studio/lib/studio-export.js'),'utf8'),/pageBrowserProvider/,'Use an assembled candidate containing the browser source overlay')
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..')
await mkdir(root)
const harness=join(root,'harness')
await mkdir(join(harness,'resources/app'),{recursive:true})
async function mirror(source,target) {
  await mkdir(target,{recursive:true})
  for(const entry of await readdir(source,{withFileTypes:true})) {
    if(entry.isDirectory())await mirror(join(source,entry.name),join(target,entry.name))
    else if(entry.isFile())await link(join(source,entry.name),join(target,entry.name)).catch(()=>copyFile(join(source,entry.name),join(target,entry.name)))
  }
}
for(const entry of await readdir(application,{withFileTypes:true})) {
  if(entry.isFile())await link(join(application,entry.name),join(harness,entry.name)).catch(()=>copyFile(join(application,entry.name),join(harness,entry.name)))
}
await mirror(join(application,'locales'),join(harness,'locales'))
await writeFile(join(harness,'resources/app/package.json'),JSON.stringify({name:'eduwork-browser-qualification',main:'main.cjs'}))
await writeFile(join(harness,'resources/app/main.cjs'),`
const {app,BrowserWindow}=require('electron');const {createRequire}=require('node:module');const {writeFileSync}=require('node:fs');
app.setPath('userData',process.env.TEST_DATA);
app.whenReady().then(async()=>{
 const {startBrowserServer}=await import(process.env.TEST_SOURCE);
 const server=await startBrowserServer({BrowserWindow,WebSocketServer:createRequire(process.env.TEST_RUNTIME+'/package.json')('ws').WebSocketServer,version:process.versions.chrome});
 writeFileSync(process.env.TEST_ENDPOINT,JSON.stringify(server.connection));
 process.on('message',async message=>{if(message==='count')process.send({count:BrowserWindow.getAllWindows().length});else{await server.close();app.quit()}});
});app.on('window-all-closed',()=>{});
`)
const fixture=createServer((_req,res)=>res.end('<!doctype html><title>浏览器测试</title><label for="name">Name</label><input id="name"><button onclick="this.innerText=String(event.isTrusted)">Click</button><div style="height:1800px">Long</div>'))
await new Promise(r=>fixture.listen(0,'127.0.0.1',r))
const url='http://127.0.0.1:'+fixture.address().port,endpointFile=join(root,'endpoint.json')
const child=spawn(join(harness,'EduWork-Electron.exe'),[],{env:{...process.env,TEST_DATA:join(root,'profile'),TEST_RUNTIME:runtime,TEST_SOURCE:pathToFileURL(join(repository,'dsh-electron/src/browser-server.mjs')).href,TEST_ENDPOINT:endpointFile},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
const exited=once(child,'exit'),watchdog=setTimeout(()=>child.kill(),180000),report={passed:false,checks:[]};let browser
const check=name=>{report.checks.push(name);console.log('PASS '+name)}
try {
 let endpoint
 for(let i=0;i<150;i++){try{endpoint=JSON.parse(await readFile(endpointFile));break}catch{await new Promise(r=>setTimeout(r,100))}}
 assert.ok(endpoint,'Electron browser server started');await unlink(endpointFile)
 for(const headers of [{},{authorization:'Bearer wrong'},{authorization:'Bearer '+endpoint.token,origin:'https://untrusted.invalid'}]) {
  const socket=new WS(endpoint.baseURL+'/managed',{headers});const error=await new Promise(r=>{socket.once('error',r);socket.once('open',()=>r(null))});socket.terminate();assert.ok(error)
 }
 check('authentication and Origin rejection')
 const connect=mode=>chromium.connectOverCDP(endpoint.baseURL+'/managed?mode='+mode,{headers:{authorization:'Bearer '+endpoint.token},timeout:15000})
 for(const mode of ['background','visible','background']) {
  browser=await connect(mode);const context=browser.contexts()[0];context.setDefaultTimeout(10000)
  const page=await context.newPage();await page.goto(url)
  assert.equal(await page.evaluate(()=>typeof require),'undefined')
  if(report.checks.includes('background'))assert.match(await page.evaluate(()=>document.cookie),/qualification=retained/)
  await page.evaluate(()=>document.cookie='qualification=retained; path=/')
  await page.getByLabel('Name').fill('synthetic');await page.getByText('Click',{exact:true}).click();assert.equal(await page.locator('button').innerText(),'true')
  await page.screenshot({path:join(root,mode+'.png'),fullPage:true})
  await page.pdf({path:join(root,mode+'.pdf'),format:'A4'})
  await page.setContent('<iframe srcdoc="<button onclick=&quot;this.innerText=String(event.isTrusted)&quot;>Frame</button>"></iframe><div id="host"></div><script>host.attachShadow({mode:"open"}).innerHTML=`<button onclick="this.innerText=String(event.isTrusted)">Shadow</button>`</script>')
  await page.frameLocator('iframe').getByText('Frame',{exact:true}).click();assert.equal(await page.frameLocator('iframe').locator('button').innerText(),'true')
  await page.getByText('Shadow',{exact:true}).click();assert.equal(await page.locator('#host button').innerText(),'true')
  await page.close();await browser.close();browser=null;check(mode)
 }
 const plugin=join(root,'test-browser-plugin')
 await cp(join(repository,'dsh-plugins/tool-browser'),plugin,{recursive:true})
 await symlink(join(runtime,'node_modules'),join(plugin,'node_modules'),process.platform==='win32'?'junction':'dir')
 const {createBrowserSearchProvider}=await import(pathToFileURL(join(plugin,'lib/search-provider.js')))
 let disposeSearch
 const provider=createBrowserSearchProvider({effect:fn=>{disposeSearch=fn()}},{connectBrowser:async()=>{
   const connection=await chromium.connectOverCDP(endpoint.baseURL+'/render',{headers:{authorization:'Bearer '+endpoint.token}})
   await connection.contexts()[0].route('https://www.bing.com/**',route=>{
     const query=new URL(route.request().url()).searchParams.get('q')
     return route.fulfill({contentType:'text/html',body:'<ul id="b_results"><li class="b_algo"><h2><a href="https://example.org/'+query+'">'+query+'</a></h2><div class="b_caption"><p>'+query+' fixture</p></div></li></ul>'})
   })
   return connection
 }})
 try {
   const result=await Promise.all(['alpha','bravo','charlie'].map(query=>provider.search({query})))
   for(let i=0;i<result.length;i++)assert.ok(JSON.stringify(result[i]).includes(['alpha','bravo','charlie'][i]))
   assert.ok(!JSON.stringify(result[0]).includes('bravo'))
   check('three concurrent search queries preserve their own results')
 } finally {await disposeSearch()}
 const {apply:installBrowserTool}=await import(pathToFileURL(join(plugin,'lib/index.js')))
 let browserTool,permissionHook,disposeTool
 const priorFlag=process.env.EDUWORK_EXPERIMENTAL_ELECTRON_BROWSER
 process.env.EDUWORK_EXPERIMENTAL_ELECTRON_BROWSER='1'
 const toolContext={tools:{register:tool=>{browserTool=tool}},get:()=>({browserConnection:async()=>endpoint}),permissionPresets:{current:()=> 'workspace-write'},on:(_name,hook)=>{permissionHook=hook},effect:fn=>{disposeTool=fn()}}
 installBrowserTool(toolContext)
 const execution=signal=>({signal,agent:{session:{id:'synthetic',header:{cwd:root}}}})
 try {
   const permission=await permissionHook({...execution(),name:'browser',args:{action:'navigate',url}},()=>({kind:'allow'}))
   assert.equal(permission.kind,'ask')
   const page=await browserTool.execute({action:'navigate',url},execution())
   assert.ok(page.text.includes('Long'))
   for(const delay of [0,5,50]) {
     await browserTool.execute({action:'close'},execution())
     const controller=new AbortController()
     const operation=browserTool.execute({action:'navigate',url},execution(controller.signal))
     const abortTimer=setTimeout(()=>controller.abort(),delay)
     await operation.catch(()=>{})
     clearTimeout(abortTimer)
     await browserTool.execute({action:'close'},execution())
   }
   const pending=browserTool.execute({action:'navigate',url},execution())
   await disposeTool()
   await assert.rejects(pending)
   check('actual DSH browser permission hook, navigation and disposal during initialization')
 } finally {await disposeTool();if(priorFlag===undefined)delete process.env.EDUWORK_EXPERIMENTAL_ELECTRON_BROWSER;else process.env.EDUWORK_EXPERIMENTAL_ELECTRON_BROWSER=priorFlag}
 const composition=join(root,'composition.jsx')
 await writeFile(composition,`import React from 'react';import {registerRoot,Composition,AbsoluteFill,useCurrentFrame} from 'remotion';const Clip=()=>React.createElement(AbsoluteFill,{style:{background:'#9f2636',color:'white',fontSize:28,paddingLeft:useCurrentFrame()*3}},'EduWork 中文 '+useCurrentFrame());registerRoot(()=>React.createElement(Composition,{id:'Probe',component:Clip,durationInFrames:20,fps:10,width:320,height:180}));`)
 const mediaRuntime={managedRequire:require,nodeModules:join(runtime,'node_modules'),openBrowser:signal=>renderBrowser(endpoint,signal,runtime)}
 const prepared=await prepareComposition({entryPoint:composition,runtime:mediaRuntime,id:'Probe'})
 await renderFrame(prepared,{output:join(root,'poster.png'),frame:4})
 await renderComposition(prepared,{output:join(root,'video.mp4'),concurrency:2})
 assert.ok((await stat(join(root,'video.mp4'))).size>1000);check('Remotion selection, still and 20-frame concurrent H264 render')
 const assets=join(root,'media');await mkdir(assets);await copyFile(join(root,'video.mp4'),join(assets,'source.mp4'))
 const pcm=Buffer.alloc(44+48000*2*2);pcm.write('RIFF');pcm.writeUInt32LE(pcm.length-8,4);pcm.write('WAVEfmt ',8);pcm.writeUInt32LE(16,16);pcm.writeUInt16LE(1,20);pcm.writeUInt16LE(1,22);pcm.writeUInt32LE(48000,24);pcm.writeUInt32LE(96000,28);pcm.writeUInt16LE(2,32);pcm.writeUInt16LE(16,34);pcm.write('data',36);pcm.writeUInt32LE(pcm.length-44,40)
 for(let i=0;i<96000;i++)pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/48000)*4000),44+i*2)
 await writeFile(join(assets,'tone.wav'),pcm)
 const mediaEntry=join(root,'media.jsx')
 await writeFile(mediaEntry,`import React from 'react';import {registerRoot,Composition,AbsoluteFill,OffthreadVideo,Audio,staticFile} from 'remotion';const Clip=()=>React.createElement(AbsoluteFill,{},React.createElement(OffthreadVideo,{src:staticFile('source.mp4'),style:{width:240,height:135}}),React.createElement(Audio,{src:staticFile('tone.wav')}),React.createElement('div',{style:{color:'white',fontSize:20,opacity:0.6}},'中文透明叠层'));registerRoot(()=>React.createElement(Composition,{id:'Media',component:Clip,durationInFrames:20,fps:10,width:320,height:180}));`)
 const media=await prepareComposition({entryPoint:mediaEntry,publicDir:assets,runtime:mediaRuntime,id:'Media'})
 await renderFrame(media,{output:join(root,'alpha.png'),frame:3})
 await renderComposition(media,{output:join(root,'with-audio-video.mp4'),concurrency:2})
 assert.ok((await stat(join(root,'with-audio-video.mp4'))).size>1000)
 check('video source, PCM audio and Chinese translucent overlay render')
 const ffprobe=require('@remotion/renderer').RenderInternals.getExecutablePath({type:'ffprobe',indent:false,logLevel:'error',binariesDirectory:null})
 const metadata=JSON.parse(execFileSync(ffprobe,['-v','error','-show_entries','stream=codec_name,codec_type,duration','-of','json',join(root,'with-audio-video.mp4')],{windowsHide:true}).toString())
 assert.ok(metadata.streams.some(stream=>stream.codec_type==='audio'&&stream.codec_name==='aac'))
 assert.ok(metadata.streams.some(stream=>stream.codec_type==='video'&&Number(stream.duration)===2))
 await writeFile(join(root,'media-metadata.json'),JSON.stringify(metadata,null,2))
 // Exercise the actual assembled Studio consumer, when it carries the source overlay.
 const studioModule=join(runtime,'node_modules/@eduwork/dsh-knowledge-studio/lib/studio-export.js')
 const {exportDocument}=await import(pathToFileURL(studioModule))
 const {mindmapFixture}=await import(pathToFileURL(join(repository,'packages/dsh-knowledge-studio/test/fixtures/mindmap-data.mjs')))
 const options={pageBrowserProvider:signal=>pageBrowser(endpoint,signal,runtime)}
 const document={id:'synthetic-report',kind:'report',title:'中文报告',citations:[],content:{sections:[{heading:'验证',body:'合成资料。',evidenceIds:[]}]}}
 const exported=await exportDocument(document,root,'pdf',options)
 assert.equal((await readFile(exported.path)).subarray(0,4).toString(),'%PDF')
 await exportDocument(mindmapFixture(),root,'png',options)
 check('assembled Studio PDF and mindmap PNG exports')
 const abort=new AbortController();abort.abort();await assert.rejects(mediaRuntime.openBrowser(abort.signal),{name:'AbortError'});check('pre-aborted render creates no browser')
 await new Promise(r=>setTimeout(r,300));const count=once(child,'message');child.send('count');assert.equal((await count)[0].count,0);check('all owned windows closed')
 const controller=new AbortController()
 const live=await mediaRuntime.openBrowser(controller.signal)
 const activePage=await live.newPage({context:()=>null,logLevel:'error',indent:false,pageIndex:0})
 controller.abort()
 await assert.rejects(activePage.evaluate(()=>1))
 await live.close({silent:true}).catch(()=>{})
 await new Promise(r=>setTimeout(r,300));const stopped=once(child,'message');child.send('count');assert.equal((await stopped)[0].count,0)
 check('active cancellation disconnects and removes owned windows')
 report.passed=true
} finally {
 if(browser)await browser.close().catch(()=>{})
 if(child.connected)child.send('close');await exited;clearTimeout(watchdog)
 await new Promise(r=>fixture.close(r));await writeFile(join(root,'result.json'),JSON.stringify(report,null,2))
}
console.log(JSON.stringify(report))
