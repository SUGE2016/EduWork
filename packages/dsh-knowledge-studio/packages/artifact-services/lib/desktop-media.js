// Optional host integration; the renderer library itself has no desktop dependency.
export function desktopMediaOptions(ctx) {
  if(process.env.EDUWORK_EXPERIMENTAL_ELECTRON_BROWSER!=='1')return {}
  const service=ctx.get('desktopServices',false)
  return {
    ...(service?.renderBrowser?{browserProvider:signal=>service.renderBrowser(signal)}:{}),
    ...(service?.pageBrowser?{pageBrowserProvider:signal=>service.pageBrowser(signal)}:{}),
  }
}
