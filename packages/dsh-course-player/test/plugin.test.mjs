import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {apply,Config} from '../lib/index.js'

test('configuration schema defaults to disabled and validates input types',()=>{
 const defaults=Config['~standard'].validate({});assert.equal(defaults.value.enabled,false);assert.equal(defaults.value.localHost,false)
 assert.ok(Config['~standard'].validate({enabled:'yes'}).issues)
})

test('disabled plugin registers nothing',()=>apply({}))
test('tool contract, permission hook and disposal',{skip:!process.env.COURSE_PLAYER_ROOT},async()=>{
 const root=await mkdtemp(join(tmpdir(),'course-plugin-'))
 let tool,guard,hook,cleanup,disposed=false,mode='workspace-write'
 const playerRoot=resolve(process.env.COURSE_PLAYER_ROOT)
 const ctx={
  tools:{register(value){tool=value;return()=>{disposed=true}},guard(value){guard=value}},
  workspaceRegistry:{resolveByPath:async path=>path===playerRoot?{id:'test',path}:undefined},
  sandboxPolicy:{resolve:()=>({mode})},
  on(event,value){assert.equal(event,'tools/pre-execute');hook=value},
  effect(factory){cleanup=factory()},
 }
 try{
  apply(ctx,{enabled:true,localHost:true,playerRoot,dataRoot:join(root,'data')})
  const exec={agent:{session:{id:'session',header:{cwd:playerRoot}}},signal:new AbortController().signal}
  assert.ok(guard({name:'course_player'}));assert.equal(guard({name:'other'}),undefined)
  const call={...exec,name:'course_player',arguments:{operation:'open'}}
  assert.equal(hook(call,()=> 'next').kind,'ask')
  mode='danger-full-access';assert.equal(hook(call,()=> 'next'),'next')
  assert.equal(hook({...call,arguments:{operation:'status'}},()=> 'next'),'next')
  await assert.rejects(tool.execute({operation:'invalid'},exec))
  await assert.rejects(tool.execute({operation:'open'},{}),/会话/)
  assert.deepEqual(await tool.execute({operation:'status'},exec),{status:'stopped'})
  const value=await tool.execute({operation:'open',coursePath:'examples/interactive'},exec)
  assert.match(tool.output.render({},value)[0].text,/\[打开课件\]\(http:\/\/127\.0\.0\.1:/)
  assert.deepEqual(await tool.execute({operation:'status'},exec),value)
  assert.equal((await fetch(value.url)).status,200)
  await cleanup();assert.ok(disposed);await assert.rejects(fetch(value.url))
 }finally{await cleanup?.();await rm(root,{recursive:true,force:true})}
})
