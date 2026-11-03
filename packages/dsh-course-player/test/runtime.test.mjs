import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {CourseRuntime,validateStudentHost} from '../lib/runtime.js'

test('student listeners reject wildcard, public, hostname and non-local addresses',()=>{
 assert.equal(validateStudentHost('127.0.0.1'),'127.0.0.1')
 for(const host of ['0.0.0.0','8.8.8.8','localhost','https://class.example','192.168.999.1','192.0.2.1'])assert.throws(()=>validateStudentHost(host))
})

test('configured LAN student endpoint leaves teacher controls local and stops cleanly',{skip:!process.env.COURSE_PLAYER_ROOT||!process.env.COURSE_STUDENT_HOST},async()=>{
 const root=await mkdtemp(join(tmpdir(),'course-lan-'))
 const host=process.env.COURSE_STUDENT_HOST
 const runtime=new CourseRuntime({playerRoot:resolve(process.env.COURSE_PLAYER_ROOT),dataRoot:root,localHost:true,studentHost:host})
 const args={workspace:{id:'lan-test',path:resolve(process.env.COURSE_PLAYER_ROOT)},sessionId:'test',parameters:{operation:'open',coursePath:'examples/interactive'}}
 try{
  const view=await runtime.invoke(args)
  assert.equal(new URL(view.url).hostname,'127.0.0.1')
  assert.equal(new URL(view.studentUrl).hostname,host)
  assert.equal((await fetch(view.studentUrl)).status,200)
  assert.equal((await fetch(new URL('/api/export.csv',view.studentUrl))).status,404)
  assert.equal((await fetch(new URL('/api/lesson/start',view.studentUrl),{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403)
  const html=await (await fetch(view.url)).text()
  const teacherOrigin=html.match(/"origin":"(http:\/\/127\.0\.0\.1:\d+)"/)[1]
  assert.equal((await (await fetch(teacherOrigin+'/api/config')).json()).student_url,view.studentUrl)
  assert.equal((await fetch(teacherOrigin+'/api/join-qr.svg')).status,200)
  const remoteTeacher=new URL(teacherOrigin);remoteTeacher.hostname=host
  await assert.rejects(fetch(remoteTeacher))
  await runtime.invoke({...args,parameters:{operation:'stop',instanceId:view.instanceId}})
  await assert.rejects(fetch(view.studentUrl));await assert.rejects(fetch(teacherOrigin))
 }finally{await runtime.close();await rm(root,{recursive:true,force:true})}
})

const playerRoot=process.env.COURSE_PLAYER_ROOT
test('managed course: reuse, session ownership, private paths and shutdown',{skip:!playerRoot},async()=>{
 const root=await mkdtemp(join(tmpdir(),'course-runtime-'))
 const runtime=new CourseRuntime({playerRoot:resolve(playerRoot),dataRoot:join(root,'data'),frameOrigins:['http://127.0.0.1:4100'],localHost:true})
 try {
   const args={workspace:{id:'one',path:resolve(playerRoot)},sessionId:'a',parameters:{coursePath:'examples/interactive'}}
   const view=await runtime.invoke(args);assert.equal(view.status,'running')
   const response=await fetch(view.url);assert.equal(response.status,200);assert.match(await response.text(),/COURSE_CONFIG/)
   assert.equal((await runtime.invoke(args)).instanceId,view.instanceId)
   const second=await runtime.invoke({...args,sessionId:'b'});assert.notEqual(second.url,view.url)
   await assert.rejects(runtime.invoke({...args,sessionId:'b',parameters:{operation:'stop',instanceId:view.instanceId}}),/当前会话/)
   assert.equal((await fetch(new URL('questions.json',view.url))).status,404)
   assert.equal((await fetch(new URL('/package.json',view.url))).status,404)
   await assert.rejects(runtime.invoke({...args,sessionId:'c',parameters:{coursePath:'../'}}),/越出/)
   await runtime.invoke({...args,parameters:{operation:'stop',instanceId:view.instanceId}})
   await assert.rejects(fetch(view.url));assert.equal((await fetch(second.url)).status,200)
   await runtime.close();await assert.rejects(fetch(second.url))
 }finally{await runtime.close();await rm(root,{recursive:true,force:true})}
})
test('failed course load releases startup lock and can retry',{skip:!playerRoot},async()=>{
 const root=await mkdtemp(join(tmpdir(),'course-retry-'))
 const runtime=new CourseRuntime({playerRoot:resolve(playerRoot),dataRoot:join(root,'data'),frameOrigins:['http://127.0.0.1:4100'],localHost:true})
 const args={workspace:{id:'retry',path:root},sessionId:'a',parameters:{}}
 try {
   const aborted=AbortSignal.abort(new Error('cancelled'))
   await assert.rejects(runtime.invoke({...args,signal:aborted}),/cancelled/)
   await assert.rejects(runtime.invoke(args))
   await writeFile(join(root,'course.json'),JSON.stringify({schemaVersion:1,id:'test',title:'Test',content:{format:'slides-js',src:'slides.js'}}))
   await writeFile(join(root,'slides.js'),'const slides = [{title:"Test",html:"<p>Hello</p>"}];')
   const view=await runtime.invoke(args);assert.equal((await fetch(view.url)).status,200)
 }finally{await runtime.close();await rm(root,{recursive:true,force:true})}
})
