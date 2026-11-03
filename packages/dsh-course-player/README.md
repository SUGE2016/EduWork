# DSH HTML 课件播放器（源码试验）

[English](README_EN.md)

[路线图](docs/ROADMAP.md) · [开发日报（2026-11-03）](docs/daily/2026-11-03.md)

独立可选工具插件，让当前会话打开工作区内的课件，并返回可点击的播放器链接。链接沿用 DSH 的侧栏浏览器或外部浏览器偏好。Studio 负责后续的课件制作；本插件不依赖 Studio，也不修改 DSH 核心或浏览器实现。

## 配置与使用

需要 Node 24+、DSH 0.2.1 兼容的工具接口（开发测试锁定 rc.5），以及包含 player/preview.cjs 的 html-course-player 源码。先在播放器仓库执行 npm ci 和 npm run build。目前为本机源码接入，尚未默认装配或发布。

插件通过 bundle 注册，默认关闭。安装并启用 bundle 后，在当前 profile 的 `cordis.patch.yml` 中添加以下配置（保留已有条目），按宿主要求重载或重启。`Config` 提供类型校验；本版没有额外的客户端配置页面，也不把这些字段加入 EduWork 顶层配置。

```yaml
- id: dsh-course-player
  config:
    enabled: true
    localHost: true
    studentHost: 127.0.0.1 # 局域网授课时改为本机网卡的私有 IPv4
    playerRoot: /absolute/path/to/html-course-player
    dataRoot: /absolute/path/to/private-classroom-data
```


启用后，在关联工作区的会话中请求“打开 examples/interactive 的课件”。Agent 调用 course_player，参数为 {"operation":"open","coursePath":"examples/interactive"}。

目录应包含 course.json，形式见播放器的 player/COURSE_FORMAT.md。返回 status、instanceId、title、url；互动课件另外返回 studentUrl（学生加入地址）；点击链接进入播放器。status 查询当前会话实例；stop 携带返回的 instanceId 结束服务。

重复打开同一课程复用实例。同会话切换课程前需停止旧实例。关闭浏览器标签页保留课堂；调用 stop 或卸载插件关闭预览及课堂服务。不同工作区、会话的课堂数据分别存储。当前没有会话关闭自动回收钩子，长期不用时应显式停止。

## 架构与权限

调用链：DSH 工具 → 课程清单校验 → 播放器回环服务 → 现有浏览器。启用课堂互动的课程另启动播放器已有的 Node 课堂服务，SQLite 数据保存在配置的 dataRoot 中。普通课件只启动静态预览服务。

课程路径限定在当前工作区内；公开路由仅包含播放器资源、声明的课件文件及 assets。题库和课堂数据库不作为静态资源公开。预览和教师控制始终绑定 127.0.0.1；学生端默认仅本机，配置 studentHost 后只绑定指定的本机局域网地址，不接受 0.0.0.0、公网地址或非本机地址。网络切换后需重新配置和开课。预览链接带随机路径，校验 Host，插件卸载时清理监听端口。非完整权限会话启动服务时走 DSH 工具授权。HTML/JS 课程可执行浏览器脚本，应使用可信课程。

当前支持本机 Host 与显式配置的局域网学生端。手机需连接可互访的同一局域网；学校 Wi-Fi 的客户端隔离或防火墙可能阻止接入。尚无课堂加入码，不应将该学生端直接暴露到公网。未来 Sites 应返回真实的学生公开 URL，并独立处理 HTTPS、课堂访问控制和路由，不通过替换 IP 拼接公网地址。远程 Host 转发、Sites 部署、发行依赖锁定及正式插件装配仍需另行完成。课程产物格式和播放器启动接口可以被未来 Studio/Sites 入口复用。

## 开发验证

设置 COURSE_PLAYER_ROOT 为播放器源码绝对路径，执行 npm test；未设置时跨仓库测试会跳过。测试覆盖工具参数/权限、会话隔离、路径边界、实例复用和卸载清理。npm run test:browser 使用 Playwright；可设置 COURSE_BROWSER_EXECUTABLE 指定本机 Chromium/Edge。测试数据来自公开示例，截图在 dist 中。

工具测试使用模拟 DSH 上下文和真实官方 defineTool；浏览器测试使用真实播放器和课堂服务。完整 DSH 桌面装配验收独立进行。
