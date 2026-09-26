import {createHash} from 'node:crypto'
import {readdirSync,statSync,openSync,readSync,closeSync} from 'node:fs'
import {resolve,join,relative} from 'node:path'
import {pathToFileURL} from 'node:url'

// Stream every byte; size and timestamps alone cannot prove cache validity.
export function hashPayload(root) {
  root=resolve(root)
  const files=[]
  function visit(directory) {
    for(const entry of readdirSync(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name)
      if(entry.isSymbolicLink())throw Error('MSI payload must not contain filesystem links: '+path)
      if(entry.isDirectory())visit(path)
      else if(entry.isFile())files.push(path)
    }
  }
  visit(root)
  files.sort((a,b)=>relative(root,a).localeCompare(relative(root,b),'en'))
  const digest=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024)
  digest.update('wix3141-x64-media200-v2\n')
  let bytes=0
  for(const path of files) {
    const before=statSync(path,{bigint:true}),hash=createHash('sha256'),fd=openSync(path,'r')
    try {for(;;){const count=readSync(fd,buffer,0,buffer.length,null);if(!count)break;hash.update(buffer.subarray(0,count))}}
    finally {closeSync(fd)}
    const after=statSync(path,{bigint:true})
    if(before.size!==after.size||before.mtimeNs!==after.mtimeNs)throw Error('Payload changed while hashing: '+path)
    digest.update(JSON.stringify([relative(root,path).replaceAll('\\','/'),String(before.size),String(before.mtimeNs),hash.digest('hex')])+'\n')
    bytes+=Number(before.size)
  }
  return {payloadKey:digest.digest('hex'),files:files.length,bytes}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==3)throw Error('Usage: node hash-payload.mjs <application-directory>')
  console.log(JSON.stringify(hashPayload(process.argv[2])))
}
