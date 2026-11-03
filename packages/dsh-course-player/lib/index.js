import z from '@deepseek-ai/schemastery'
import {defineTool} from '@deepseek-ai/dsh-tools'
import {CourseRuntime} from './runtime.js'
export const name='dsh-course-player'
export const Config=z.object({
  enabled:z.boolean().default(false).description('启用课件工具'),
  localHost:z.boolean().default(false).description('确认播放器与当前桌面运行在同一台机器'),
  studentHost:z.string().default('127.0.0.1').description('学生端监听地址：本机局域网 IPv4，或 127.0.0.1 仅本机试用；教师端始终仅本机'),
  playerRoot:z.string().description('html-course-player 源码绝对路径（先执行 npm ci 和 npm run build）'),
  dataRoot:z.string().description('课堂私有数据绝对路径'),
  frameOrigins:z.array(z.string()).default([]).description('允许嵌入的浏览器来源；原生侧栏浏览器无需配置'),
})
export const inject=['tools','workspaceRegistry','sandboxPolicy']
export function apply(ctx,config={}) {
  if(config.enabled!==true)return
  const runtime=new CourseRuntime(config)
  const dispose=ctx.tools.register(defineTool({
    name:'course_player',
    description:'Open, inspect or stop a local HTML course player in the current workspace. Return url as the teacher playback link for the existing browser; studentUrl is the separate student join link, when available. Student LAN access requires operator configuration; the tool cannot change the listening address. This does not create a Studio artifact or automatically open a browser. Closing a tab does not stop the classroom: call stop with its instanceId.',
    parameters:{operation:{type:'string',required:true,enum:['open','status','stop']},coursePath:{type:'string',description:'Workspace-relative course directory containing course.json.'},instanceId:{type:'string',description:'Required for stop; returned by open/status.'}},
    output:{schema:{type:'object',additionalProperties:false,properties:{status:{type:'string',required:true,enum:['running','stopped']},instanceId:{type:'string'},title:{type:'string'},url:{type:'string'},studentUrl:{type:'string'}}},
      render:(_args,value)=>[{type:'text',text:JSON.stringify(value)+'\n'+(value.url?`[打开课件](${value.url})\n服务已就绪。打开链接进入现有浏览器；关闭标签页不会结束课堂。`:'课程服务已停止。')}]},
    async execute(parameters,exec) {
      const cwd=exec.agent?.session?.header?.cwd,sessionId=exec.agent?.session?.id
      if(!cwd||!sessionId)throw new Error('课件工具需要关联工作区的会话')
      const workspace=await ctx.workspaceRegistry.resolveByPath(cwd)
      if(!workspace)throw new Error('当前会话没有有效工作区')
      return runtime.invoke({workspace,sessionId,parameters,signal:exec.signal})
    },
    presentCall:args=>({card:'generic',title:args.operation==='stop'?'结束课件服务':args.operation==='status'?'查看课件状态':'准备课件播放器',kind:args.operation==='status'?'read':'write'}),
  }))
  ctx.tools.guard(exec=>exec.name==='course_player'&&!exec.agent?'课件工具需要 Agent 会话':undefined)
  ctx.on('tools/pre-execute',(exec,next)=>{
    if(exec.name!=='course_player'||exec.arguments?.operation!=='open')return next()
    if(exec.agent&&ctx.sandboxPolicy.resolve({session:exec.agent.session}).mode==='danger-full-access')return next()
    const lan=config.studentHost&&config.studentHost!=='127.0.0.1'
    return {kind:'ask',reason:'Start course services using operator-configured network access',displayReason:lan?
      {zh:`允许读取工作区课件，并在 ${config.studentHost} 开放学生答题服务、保存课堂记录；教师控制仅本机`,en:`Allow workspace course services and student LAN access on ${config.studentHost}; teacher controls stay local`}:
      {zh:'允许读取此工作区课件、启动本机回环服务，并按需保存课堂记录',en:'Allow reading workspace courses, starting loopback services and saving classroom records'}}
  })
  ctx.effect(()=>async()=>{dispose();await runtime.close()},'course-player: dispose local services')
}
