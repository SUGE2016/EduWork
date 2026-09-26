import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,utimesSync,statSync,rmSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {hashPayload} from '../scripts/windows-msi/hash-payload.mjs'

test('CAB cache detects changed bytes with identical size and timestamp',t=>{
  const root=mkdtempSync(join(tmpdir(),'eduwork-msi-hash-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const path=join(root,'payload');writeFileSync(path,'one');utimesSync(path,1700000000,1700000000)
  const first=hashPayload(root)
  assert.deepEqual(hashPayload(root),first)
  writeFileSync(path,'two');utimesSync(path,1700000000,1700000000)
  assert.equal(statSync(path).size,3)
  assert.notEqual(hashPayload(root).payloadKey,first.payloadKey)
})

test('payload hashing refuses directory links instead of following mutable external files',t=>{
  const root=mkdtempSync(join(tmpdir(),'eduwork-msi-links-')),outside=mkdtempSync(join(tmpdir(),'eduwork-msi-outside-'))
  t.after(()=>{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})})
  symlinkSync(outside,join(root,'linked'),process.platform==='win32'?'junction':'dir')
  assert.throws(()=>hashPayload(root),/filesystem links/)
})
