import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright-core'
import {apply} from '../lib/index.js'

if(!process.env.COURSE_PLAYER_ROOT)throw new Error('Set COURSE_PLAYER_ROOT')
const playerRoot=resolve(process.env.COURSE_PLAYER_ROOT)
const data=await mkdtemp(join(tmpdir(),'course-browser-'))
let tool,cleanup,browser
try {
 apply({
  tools:{register(value){tool=value;return()=>{}},guard(){}},
  workspaceRegistry:{resolveByPath:async path=>({id:'browser-test',path})},
  sandboxPolicy:{resolve:()=>({mode:'danger-full-access'})},
  on(){},effect(factory){cleanup=factory()},
 },{enabled:true,localHost:true,playerRoot,dataRoot:data})
 const exec={agent:{session:{id:'browser',header:{cwd:playerRoot}}}}
 const view=await tool.execute({operation:'open',coursePath:'examples/interactive'},exec)
 browser=await chromium.launch({headless:true,...(process.env.COURSE_BROWSER_EXECUTABLE?{executablePath:process.env.COURSE_BROWSER_EXECUTABLE}:{channel:'msedge'})})
 const page=await browser.newPage({viewport:{width:1440,height:900}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(view.url)
 await page.waitForFunction(()=>globalThis.Reveal?.isReady())
 assert.equal(await page.locator('.reveal .slides > section').count(),3)
 await page.locator('.present .classroom-point').first().click()
 await page.locator('.classroom-window').waitFor({state:'visible'})
 const teacher=page.frameLocator('iframe[title="课件内提问与实时统计"]')
 await teacher.locator('body').getByText('函数图中的输入参数对应什么？',{exact:false}).first().waitFor()
 await mkdir('dist',{recursive:true})
 await page.screenshot({path:'dist/course-browser.png'})
 await page.locator('.classroom-window [data-close]').click()
 await page.locator('.classroom-window').waitFor({state:'hidden'})
 await page.keyboard.press('ArrowRight')
 await page.waitForFunction(()=>globalThis.Reveal.getIndices().h===1)
 assert.deepEqual(errors,[])
 assert.equal((await tool.execute({operation:'status'},exec)).instanceId,view.instanceId)
 await tool.execute({operation:'stop',instanceId:view.instanceId},exec)
 await assert.rejects(fetch(view.url))
 console.log('PASS: tool URL -> three slides -> classroom question -> next slide -> stop. Synthetic DSH context, real browser and services.')
}finally{
 await browser?.close();await cleanup?.();await rm(data,{recursive:true,force:true})
}
