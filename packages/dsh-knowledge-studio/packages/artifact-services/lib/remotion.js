/** Shared rendering backend for structured templates and editable projects. */
export async function prepareComposition({entryPoint, outDir, publicDir, inputProps, id, runtime, onProgress=()=>{}}) {
  const bundler=runtime?.managedRequire ? runtime.managedRequire('@remotion/bundler') : await import('@remotion/bundler')
  const renderer=runtime?.managedRequire ? runtime.managedRequire('@remotion/renderer') : await import('@remotion/renderer')
  const serveUrl=await bundler.bundle({entryPoint,...(outDir?{outDir}:{}),...(publicDir?{publicDir}:{}),onProgress:percent=>onProgress('bundle',percent),
    ...(runtime?.nodeModules?{webpackOverride:configuration=>({...configuration,
      resolve:{...configuration.resolve,modules:[runtime.nodeModules],symlinks:false},
      resolveLoader:{...configuration.resolveLoader,modules:[runtime.nodeModules],symlinks:false}})}:{})})
  const browser=await runtime?.openBrowser?.(runtime.signal)
  try {
    runtime?.signal?.throwIfAborted()
    const composition=await renderer.selectComposition({serveUrl,id,inputProps,...(browser?{puppeteerInstance:browser}:{}),...(runtime?.browserExecutable?{browserExecutable:runtime.browserExecutable}: {})})
    return {renderer,serveUrl,composition,inputProps,openBrowser:runtime?.openBrowser,runtimeSignal:runtime?.signal,...(runtime?.browserExecutable?{browserExecutable:runtime.browserExecutable}:{})}
  } finally {await browser?.close({silent:true})}
}

export async function renderComposition(prepared,{output,format='mp4',signal,onProgress=()=>{},concurrency=2}) {
  signal?.throwIfAborted()
  const {renderer,openBrowser,runtimeSignal,...options}=prepared
  signal ??= runtimeSignal
  const browser=await openBrowser?.(signal)
  const {cancelSignal,cancel}=renderer.makeCancelSignal()
  const abort=()=>cancel();signal?.addEventListener('abort',abort,{once:true})
  try {
    if(signal?.aborted)cancel()
    await renderer.renderMedia({...options,...(browser?{puppeteerInstance:browser}:{}),outputLocation:output,codec:format==='wav'?'wav':'h264',
      ...(format==='mp4'?{audioCodec:'aac'}:{}),concurrency,cancelSignal,onProgress:({progress})=>onProgress('render',progress*100)})
  } finally {signal?.removeEventListener('abort',abort);await browser?.close({silent:true})}
}

export async function renderFrame(prepared,{output,frame}) {
  const {renderer,openBrowser,runtimeSignal,...options}=prepared
  const browser=await openBrowser?.(runtimeSignal)
  try {
    runtimeSignal?.throwIfAborted()
    await renderer.renderStill({...options,...(browser?{puppeteerInstance:browser}:{}),output,frame,imageFormat:'png'})
  } finally {await browser?.close({silent:true})}
}
