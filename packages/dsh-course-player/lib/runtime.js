import {realpath,mkdir} from 'node:fs/promises'
import {resolve,relative,isAbsolute,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash,randomUUID} from 'node:crypto'

export class CourseRuntime {
  #instances=new Map(); #pending=new Set(); #tasks=new Set(); #closed=false
  constructor({playerRoot,dataRoot,frameOrigins=[],localHost=false}) {
    if(!localHost)throw new Error('课程预览目前仅支持明确配置的本机 Host')
    if(!isAbsolute(playerRoot||'')||!isAbsolute(dataRoot||''))throw new Error('请配置播放器及课程数据绝对路径')
    if(!Array.isArray(frameOrigins))throw new Error('无效的浏览器嵌入来源配置')
    this.config={playerRoot,dataRoot,frameOrigins}
  }
  invoke(args) {
    const task=this.#invoke(args);this.#tasks.add(task)
    task.then(()=>this.#tasks.delete(task),()=>this.#tasks.delete(task));return task
  }
  async #invoke({workspace,sessionId,parameters={},signal}) {
    signal?.throwIfAborted()
    if(this.#closed)throw new Error('课程插件已关闭')
    if(typeof sessionId!=='string'||!sessionId)throw new Error('课程需要有效会话')
    const key=JSON.stringify([workspace.id,sessionId]);
    const current=this.#instances.get(key)
    if(parameters.operation==='status')return current?current.view:{status:'stopped'}
    if(parameters.operation==='stop') {
      if(this.#pending.has(key))throw new Error('课程服务正在切换，请稍后重试')
      if(!current||current.id!==parameters.instanceId)throw new Error('课程实例不属于当前会话')
      this.#pending.add(key)
      try{await current.stop();this.#instances.delete(key);return {status:'stopped'}}finally{this.#pending.delete(key)}
    }
    if(parameters.operation!==undefined&&parameters.operation!=='open')throw new Error('未知课程操作')
    if(this.#pending.has(key))throw new Error('课程正在启动，请稍后重试')
    this.#pending.add(key)
    try {
      const root=await realpath(workspace.path),requested=parameters.coursePath||'.'
      if(typeof requested!=='string'||isAbsolute(requested))throw new Error('请选择工作区内的课程相对目录')
      const course=await realpath(resolve(root,requested)),rel=relative(root,course)
      if(rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(rel))throw new Error('课程目录越出工作区')
      if(current){if(current.course!==course)throw new Error('请先结束当前课程预览');return current.view}
      const module=await import(pathToFileURL(join(this.config.playerRoot,'player/preview.cjs')).href)
      const preview=await module.startPreview({courseDir:course,frameOrigins:this.config.frameOrigins})
      let classroom
      try {
        const settings=preview.manifest.plugins?.classroom
        if(settings) {
          if(typeof settings.questions!=='string')throw new Error('课堂插件缺少题库')
          const data=join(this.config.dataRoot,createHash('sha256').update(key+'\0'+course).digest('hex'))
          await mkdir(data,{recursive:true})
          const {startClassroom}=await import(pathToFileURL(join(this.config.playerRoot,'classroom/dist/index.js')).href)
          classroom=await startClassroom({dbPath:join(data,'classroom.sqlite3'),questionsPath:join(course,settings.questions),
            teacherPort:0,studentPort:0,studentHost:'127.0.0.1',cookiePrefix:'course_'+createHash('sha256').update(data).digest('hex').slice(0,16),
            frameOrigins:[preview.origin,...this.config.frameOrigins]})
          preview.setRuntime({classroomOrigin:new URL(classroom.teacherUrl).origin})
        }
        if(this.#closed)throw new Error('课程插件已关闭')
        signal?.throwIfAborted()
        const id=randomUUID(),view={status:'running',instanceId:id,title:preview.manifest.title,url:preview.url}
        const instance={id,course,view,stop:async()=>{try{await classroom?.stop()}finally{await preview.stop()}}}
        this.#instances.set(key,instance);return view
      }catch(error){try{await classroom?.stop()}finally{await preview.stop()}throw error}
    }finally{this.#pending.delete(key)}
  }
  async close(){this.#closed=true;await Promise.allSettled([...this.#tasks]);await Promise.all([...this.#instances.values()].map(i=>i.stop()));this.#instances.clear()}
}
