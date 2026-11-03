# 课件插件路线图

## 已完成（源码试验）

- 复用官方 DSH 工具、权限和工作区接口，返回链接交给既有用户侧栏/外部浏览器。
- open/status/stop、会话实例隔离、清单与路径校验、卸载清理。
- rc.5 配置类型校验和开发依赖；操作员配置学生局域网地址，模型不能改变监听范围。
- 教师控制和播放器仅本机；学生链接单独返回，默认仍仅本机。
- macOS 原生真实模型播放、教师交互、用户微信扫码后的作答统计及 CSV 核对。

## 下一阶段：最小教学流程

1. 明确 courseId、classId、lessonId 与 Studio artifactId/revision 的关系。现有 workspace/session/course 分区只适合试用，不能代替跨会话的课程与教学班身份。
2. 提供“选课程/班级 → 导入名单 → 开课 → 下课导出”流程，复用播放器已有 roster、lessons、轮次和 CSV 服务。
3. 补网络配置入口、课堂加入码、临时链接失效提示；网络切换需重新选地址。授课验收包含手机加入、提交、教师统计和结束后不可访问。
4. 为 Studio 增加 HTML 课件成果适配，复用既有来源、修订和下载机制。课件制作/PPT 转换由 Studio 的技能和共享 Office 服务承担，不在播放器创建另一套生成入口。

## 后续

- 点名与签到：基于教学班名单，区分未加入、未作答和缺勤，支持教师纠正。
- 名单同步与作业：通用契约留 EduWork，机构认证和校内服务映射留 EduWork-ECNU；优先接已有平台。
- Sites：由部署服务返回学生公网 URL，独立处理 HTTPS、课堂鉴权、隔离和撤销。不能把局域网 URL 换成域名就视为公网支持，也不能公开教师控制端。

尚未发布插件或纳入默认装配；上述下一阶段和后续能力均未完成。播放器及 Studio 技能草案见 [html-course-player 路线图](https://github.com/SUGE2016/html-course-player/blob/feat/course-player-macos/docs/ROADMAP.md)。
