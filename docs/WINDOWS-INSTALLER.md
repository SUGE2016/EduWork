# Windows 安装界面与签名

## 品牌安装向导

`scripts/package-windows-msi.ps1` 使用固定版本 WiX 3.14.1 生成中文 MSI。欢迎页与完成页使用 EduWork 红色折页 E 标识；设置页支持安装目录、桌面快捷方式和安装后启动。按钮保留 Windows Installer 原生样式，不承诺与设计效果图逐像素一致。

安装仍按当前用户进行，默认目录为 `%LOCALAPPDATA%\EduWork`。桌面快捷方式默认勾选，安装后启动默认不勾选；启动操作只在成功安装后的“完成”按钮上执行，静默安装、取消、失败、修复或卸载不启动应用。开始菜单入口保持原有行为。配置与用户数据继续保留。

界面定义位于 `scripts/windows-msi/EduWorkUI.wxs`，文案位于 `zh-cn.wxl`；`build-artwork.ps1` 从仓库品牌图标生成 MSI 位图。维护、取消、错误和进度页面复用 WiX 中文对话框。

```powershell
./scripts/package-windows-msi.ps1 -App <已装配的应用目录> -Output <输出路径.msi>
./scripts/test-windows-msi.ps1 -Msi <输出路径.msi>
msiexec /i <输出路径.msi> /qn /norestart DESKTOP_SHORTCUT=0
```

候选构建 CI 直接从应用目录生成 MSI，不再生成中间 ZIP；检查实际 MSI 的界面表、跨语言升级规则、目录验证和启动条件，并执行默认快捷方式安装、卸载及禁用快捷方式重装验证。升级与降级检测不限定产品语言，以兼容此前的英文 MSI；保留相同三段版本号可升级的行为。真实旧版升级、向导布局、目录浏览、返回、取消和完成后启动仍需 Windows 验收；安装包结构检查不能替代这些验收。

## 增量打包

打包脚本默认在 `%LOCALAPPDATA%\EduWorkBuildCache\wix3` 保存经过摘要校验的 WiX 下载包与 CAB，可用 `-CacheDirectory` 指定缓存目录。CI 通过 Actions cache 保留该目录。未改变应用文件、仅修改安装界面时，Light 使用 `-cc` 与 `-reusecab` 复用压缩结果；源码重新装配改变文件时间戳时可能无法命中，因此界面迭代应复用已装配的应用目录。

CAB 缓存键包含文件相对路径、大小、时间戳及 SHA-256，避免保留时间戳的内容修改误用旧包。同一缓存键不允许并发写入。默认每次仍执行 MSI 编译与校验，并输出 `.msi.build.json` 记录工具准备、内容散列、链接和总耗时。缓存改善构建过程，不代表安装耗时也会下降。

完整 Chromium 同时承担后台渲染和可见受管浏览器，后者用于登录及验证码并共享独立用户目录。Headless Shell 不能直接替代完整发行包中的这一能力；精简浏览器前须同时验证后台渲染、可见交互和模式切换后的登录状态。

## 机构发行版的品牌覆盖

安装逻辑和向导模板由公版维护；机构仓库维护自己的 JSON 配置与素材，通过 `-BrandingFile` 传入，不复制安装脚本。省略此参数时使用 `scripts/windows-msi/brand.json`，保留公版安装身份。机构应用先按其发行配置装配，品牌文件的 `distribution` 必须与应用的 `eduwork.desktop.json` 一致。

```powershell
& "$CoreRoot/scripts/package-windows-msi.ps1" -App $App -Output $Msi -BrandingFile ./edition/windows-installer/brand.json
& "$CoreRoot/scripts/test-windows-msi.ps1" -Msi $Msi -BrandingFile ./edition/windows-installer/brand.json
```

配置结构以公版 `scripts/windows-msi/brand.json` 为模板，所有字段必填：

| 字段 | 作用 |
| --- | --- |
| `schemaVersion` | 固定为 `1` |
| `distribution` | 已装配应用的发行标识 |
| `productName`、`manufacturer` | 安装向导、系统应用记录和快捷方式的名称，以及厂商 |
| `icon`、`logo` | ICO 安装图标、PNG/BMP 向导标识；相对路径从品牌 JSON 所在目录解析 |
| `accentColor`、`welcomeText` | `#RRGGBB` 主色与欢迎页文案 |
| `installDirectory`、`registryKey` | 当前用户应用目录名和 HKCU 下的 `Software\...` 注册表键 |
| `upgradeCode` | 此发行版固定的升级 GUID；后续版本必须沿用 |
| `executable` | 应用根目录中已有的 EXE 文件名，决定快捷方式和完成后启动目标 |

新机构发行版应使用独立的产品名称、升级 GUID、安装目录和注册表键，避免替换公版或覆盖其快捷方式；脚本拒绝机构版误用公版的这四项身份。迁移已有机构 MSI 时必须核对原安装身份，不能每次打包生成新 GUID。`productName` 应与机构配置中的产品名称保持一致。

这些参数只配置 MSI，不会重命名或修改包内 EXE，也不会改变 Electron 的 appId、更新源、数据目录或 EXE 内嵌图标。应用内名称和 Logo 仍由发行配置与 `eduwork.jsonc` 决定；完整应用品牌需要在装配层统一处理。机构仓更新 `core.lock.json` 到包含该接口且已验证的核心版本后，才能调用这一参数；本改动不自动修改机构仓或发布新版本。

## 将签名接入 GitHub Actions

当前工作流尚未启用 Windows 签名。以下是接入方案，不代表签名 runner 或证书已配置。

现有 SimplySign 云证书通过 SimplySign Desktop 提供给 Windows SignTool。Certum 官方流程要求先用移动端 token 登录 Desktop，随后通过证书指纹签名；部分卡还需 PIN。仅有 `.cer` 文件或 GitHub Secret 中的证书指纹不能访问云端私钥。官方文档未给出适用于 GitHub 托管 runner 的无人值守登录方案，不能把已有本地签名成功视为 CI 自动登录已解决。

可采用 GitHub 托管 runner 构建、专用 Windows runner 签名的两阶段流程。签名 runner 安装 SimplySign Desktop 与 Windows SDK SignTool，以已经登录 SimplySign 的同一 Windows 账户和交互会话运行；不要直接假定作为系统服务运行也能访问该会话。需要先验证签名会话的有效期、PIN 行为和失效后的恢复方式。

对于公开仓库，签名 runner 宜放在受限私有签名仓库；由维护者选定已验收的构建运行、提交 SHA、artifact 和 MSI 摘要。只下载并签署该 MSI，不运行 artifact 中的脚本或应用。不要让公开 PR 工作流使用持有证书访问权的 runner。环境审批可作为附加关卡，但不能代替 runner 隔离。

第一阶段只签 MSI 外层，顺序为：

1. 构建 MSI、安装卸载验收，上传未签名 artifact。
2. 签名 job 核对获批构建来源与未签名 SHA-256。
3. SignTool 签名并添加 RFC 3161 时间戳，随后验证全部签名。
4. 对签名后的 MSI 重新计算 `.sha256`，上传为新的签名 artifact。
5. 发布 job 只使用签名 artifact，并再次验证摘要；签名失败不得降级发布未签名包。

签名步骤的核心命令如下；`SIGNTOOL_PATH` 和 `WINDOWS_SIGNING_THUMBPRINT` 由签名机器配置，证书主体和指纹不写死在公版源码中。

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
& $env:SIGNTOOL_PATH sign /sha1 $env:WINDOWS_SIGNING_THUMBPRINT /fd SHA256 /tr http://time.certum.pl /td SHA256 $msi
& $env:SIGNTOOL_PATH verify /pa /all /v $msi
$signature = Get-AuthenticodeSignature -LiteralPath $msi
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Thumbprint -ne $env:WINDOWS_SIGNING_THUMBPRINT -or -not $signature.TimeStamperCertificate) {
    throw 'MSI signature, signer or timestamp validation failed'
}
$hash = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($msi))" | Set-Content ($msi + '.sha256') -Encoding ascii
```

MSI 签名不等于包内 EXE 已签名。若以后需要对应用可执行文件签名，应在最终打包和生成文件摘要之前执行，再验证应用目录、更新清单与 MSI 中的文件一致性；这是另外的发行流程改动。

参考：[WiX 界面定制](https://docs.firegiant.com/wix3/wixui/wixui_customizations/)、[Certum SignTool 操作说明](https://files.certum.eu/documents/manual_en/CS-Code_Signing_in_the_Cloud_Signtool_jarsigner_signing.pdf)、[GitHub 自托管 runner 注意事项](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners)。

## 本地迭代性能

打包使用固定 WiX 下载缓存及按内容摘要区分的 CAB 缓存。摘要工具流式读取每个文件的内容，并纳入相对路径、大小和修改时间；拒绝文件系统链接，避免缓存随外部目录变化。不能仅凭大小和时间戳复用 CAB。

仅调整界面时应复用同一份已装配应用目录，并复用 `-CacheDirectory`。开发版还可显式传入 `-SkipIceValidation` 生成界面预览包；回执中的 `iceValidated` 为 false。此选项不适用于正式版本，也不用于发布流水线；交付前仍需通过完整校验和安装测试。它缩短开发反馈时间，不代表已改善用户安装耗时。

每次输出 `.msi.build.json`，记录文件数、字节数、负载摘要、ICE 状态及工具准备／摘要／链接／总耗时。CAB 缓存减少重新压缩工作，安装时仍会落盘原有文件。将依赖 ZIP 后再解压并不会减少最终文件数，还会增加首次启动、回滚和修复的复杂度，因此当前没有添加解压自定义动作。

完整验证保留原有 ICE38、ICE64 例外，并增加 ICE91 例外。安装包通过 `NOT ALLUSERS` 条件明确拒绝机器级安装；[微软对 ICE91 的说明](https://learn.microsoft.com/en-us/windows/win32/msi/ice91)指出，这类警告对于只支持当前用户安装的包无害。这样避免为每个负载文件重复输出同一项无关警告。其余 ICE 默认执行，输出保存在 `.msi.light.log` 中。

回执的 `cabinetsReused` 来自 Light 实际日志。不要通过 CAB 修改时间判断缓存是否命中：[WiX 3.14.1 源码](https://github.com/wixtoolset/wix3/blob/wix3141rtm/src/tools/wix/Binder.cs#L6514-L6525)会在复用时刷新缓存时间。
