# dsh-dev-env

[English](README.md) | [简体中文](README.zh-CN.md)

一个 DSH 插件：把本机已装好的开发与测试工具链盘点出来，显示在 DSH 的 Web 界面里，标出缺口，并能一键补齐。

**只支持 Windows。** 插件要读 Windows 的卸载注册表、要驱动 `winget`，在 macOS 和 Linux 上跑不起来。

截图应当放在 `docs/screenshot.png`，需要维护者自己补上。

## 你能得到什么

### 侧栏面板

DSH Web 界面里的一个全局面板：`sidebar.panellist` 中 id 为 `dev-env` 的条目，对应 `main` 里同名的 key。
面板把目录分成 5 类，逐条显示探测到的版本和它所在的位置——探测不到时显示原因。缺口会被高亮，每条缺口带三个动作：

- **一键补齐** —— 执行选中的补齐方案，结果实时流进下面的任务列表；
- **下载页** —— 用默认浏览器打开厂商官方页面；
- **复制命令** —— 把完整的命令行复制到剪贴板。

每一行下面有一句话说明**这个工具到底是什么**，写给从没听说过它的人看；右侧还有一个 `↗` 按钮，打开它的百科词条：
**中文界面走百度百科，英文界面走维基百科**。两者都用站点的**搜索入口**而不是固定词条 URL，所以词条被改名
也不会变成死链，也就不需要为 82 个条目各维护一个链接。这些说明放在 `describe.js` 里、按条目 id 索引；
`npm test` 强制每个目录条目都必须有中英两条。

顶部的胶囊标签汇总已安装 / 缺失 / 核心必备缺失 / 总数以及扫描时间；下方的任务列表显示实时状态和安装输出的尾部。
样式只用主题 token（`--dsw-alias-*`），浅色和深色主题都能正常跟随。

**安装过程会报进度。** 每个任务都带阶段（`下载中` / `校验中` / `安装中` / `完成`）、安装器最后打印的那一行，
以及它打印出体积时的体积数字；进度条在能从输出里解析出百分比时是确定的，否则是不确定进度——
面板不会凭空编一个它并不知道的数字。已用时长每秒走字，正在安装的那条目录行会就地显示阶段，
并且**整个安装期间**按钮都是禁用的（不只是点击的那一瞬间）。有任务在跑时，任务列表的轮询从 2 秒压到 1 秒。

面板标题栏有一个语言切换按钮，**默认显示中文**。按钮上写的始终是"切过去之后的语言"，并用该语言书写
（中文界面显示 `English`，英文界面显示 `中文`），选择会按浏览器记住。界面文字、分类名和条目名都会跟着切换。
它刻意不跟随 DSH 的语言设置：两种词条都打包在插件里。

### Agent 工具

| 工具 | 用途 | 参数 |
| --- | --- | --- |
| `dev_env_inventory` | 返回完整清单、缺口列表，以及补上每条缺口要执行的命令。 | `refresh`（布尔，绕过 60 秒缓存）、`only`（`all` \| `missing` \| `installed`）、`category`（`language` \| `ide` \| `test` \| `data` \| `tool`）、`verbose`（布尔，在文本结果里逐条列出全部） |
| `dev_env_install` | 补齐一条缺口。它会改动本机环境，所以只在用户明确要求时调用。 | `id`（必填）、`mode`（`auto` \| `winget` \| `npm` \| `pip` \| `page` \| `command`） |
| `dev_env_job` | 查询补齐任务的状态、退出码与最近日志。 | `jobId`（省略则列出最近任务）、`tailLines`（默认 30） |

`dev_env_install` 的 `mode: "command"` 是空跑：只返回候选命令，不执行任何东西。

### HTTP API

面板和工具一样，都是 host 半边的消费者：

| 方法 | 路径 | 输入 | 返回 |
| --- | --- | --- | --- |
| `GET` | `/dsh-dev-env/api/inventory` | `?refresh=1` 绕过缓存 | 完整清单：`items`、`categories`、`summary` |
| `GET` | `/dsh-dev-env/api/jobs` | – | 补齐任务列表，最新的在前 |
| `POST` | `/dsh-dev-env/api/install` | `{ "id": "gcc", "mode": "auto" }` | 已启动的任务，以及该条目可用的方案 |
| `POST` | `/dsh-dev-env/api/open` | `{ "url": "https://example.com" }` | 用默认浏览器打开该地址 |

条目 id 未知时返回 `404`；`mode` 找不到对应方案（或 url 不是 `http(s)`）时返回 `400`；方法不对返回 `405`。
`mode: "command"` 只属于工具；HTTP 端点接受 `auto` 或某个具体方案的模式。

## 运行要求

- Windows 10 或 11。已在 Windows 11 + DSH 0.2.0-rc.2 上验证。
- Node.js 18 或更新（见 `package.json` 的 `engines`）。
- 没有任何运行时依赖。插件有意不声明 peer dependency，这样 DSH 安装前的版本兼容性门禁永远不会拦住它。
- `winget`：走 winget 的补齐需要它。面板把 `winget` 本身就当成一条目录项，而「下载页」兜底方案不依赖它。
- Python 和/或 Node.js：只在个别条目需要 `pip` / `npmGlobal` 探测或 `pip` / `npm` 补齐方案时才需要。

## 安装

两个渠道都已上线，任选一个 spec。

**npm —— 零前置依赖。** 不需要 `git`、不需要 Node，什么都不用先装：

```
@cszi666/dsh-dev-env
```

**GitHub —— 跟随默认分支**，但需要本机有 `git`：DSH 会先用 `git ls-remote` 校验仓库，pnpm 也走 git 拉取。

```
github:cszi666/dsh-dev-env
```

### 在 DSH 桌面版里（不需要 CLI）

桌面版把 CLI 打包在 `app.asar` 内部、不会暴露到 `PATH`，而且 **`desktop` profile 归 Electron 所有**——
用 npm 装的 `dsh` CLI 会被拒绝管理它。所以在 DSH 内部安装：

- **直接吩咐 Agent。** 在任意会话里粘贴：

  ```
  安装 DSH 插件 @cszi666/dsh-dev-env
  ```

  Agent 会用 `plugin_manager` 发起 `action: install_bundle`、`target` 填这个 spec，并应用到当前 profile。
  它会请求授权，同意即可（`plugin_manager` 需要 `danger-full-access` 或单次批准）。如果你的 Agent 预设没有
  暴露这个工具，就用下面的面板。
- **或者用面板。** **设置 → 插件**，粘贴同一个 spec。

装完如果侧栏没出现，刷新页面；如果面板出现了但它的 API 返回 `404`，重启一次 DSH（见[踩坑](#踩坑)）。

### 用 `dsh` CLI（npm 管理的 profile）

```powershell
npm install -g @deepseek-ai/dsh        # 还没有 CLI 才需要
dsh plugin --profile <profile> add @cszi666/dsh-dev-env
```

`dsh plugin` 会把参数原样转发给 profile 目录里的 pnpm，所以任何 pnpm spec 都成立：
`@scope/name`、`github:owner/repo`、`https://github.com/owner/repo`、`.tgz` 链接、版本范围都行。`<profile>`
填你在用的那个 profile——**不能填 `desktop`**，它归 Electron 应用所有。

npm 包目前挂在 `@cszi666` scope 下。等 npm 对 `dsh-dev-env` 这个未加 scope 的名字的取消发布冷却期结束后，
计划发一个同名的不带 scope 版本；真到那时只有这个 spec 会变，GitHub spec 和仓库名都不受影响。

对 GitHub 仓库，DSH 会先用 `git ls-remote` 确认可达性，所以账号或仓库名打错会立刻失败，而不是装到一半才报错。

## 工作原理

### 目录（catalog）

`catalog.js` 是唯一的真源：82 个条目、5 个分类，每个条目同时声明「怎么探测」和「怎么补齐」。

| 分类 id | 条目数 | 覆盖范围 |
| --- | --- | --- |
| `language` | 23 | 语言与运行时：JDK、Python、Node.js、.NET、Go、Rust、GCC/Clang…… |
| `ide` | 20 | IDE 与编辑器：JetBrains 全家桶、VS Code、Visual Studio、Eclipse、DevEco Studio…… |
| `test` | 16 | 测试工具：JMeter、禅道、Postman、pytest、Selenium、Playwright、Appium…… |
| `data` | 10 | 数据库、中间件与 CI：MySQL、PostgreSQL、MongoDB、Tomcat、Jenkins、Docker…… |
| `tool` | 13 | 构建与命令行工具：Git、CMake、Ninja、Maven、Gradle、winget、Scoop…… |

标了 `essential: true` 的 11 个条目会单独计入「核心必备缺失」，这样缺一个编译器不会被一堆可选缺失淹没。

### 探测方式

| `probe.kind` | 做什么 | 字段 |
| --- | --- | --- |
| `argv` | 执行命令，用 `pattern` 从 `stdout` + `stderr` 里抓版本号。 | `argv`，可选 `pattern` |
| `versionFile` | 读一个确定的文件，用 `pattern` 抓版本号。 | `path`，可选 `pattern`、`prefix`、`suffix` |
| `pathList` | 从一份有序的、做过环境变量展开和通配展开的候选列表里取第一个存在的。 | `paths`；可选 `file`、`pattern`、`requires`、`prefix`、`suffix`、`version` |
| `dir` | 环境变量展开后的路径上，文件或目录存在即算命中。 | `path` |
| `pip` | 执行 `python -m pip show <module>`，读 `Version:`。 | `module` |
| `npmGlobal` | 全局 npm 根目录（`npm root -g`）下的一个包目录。 | `name` |
| `registry` | Windows 卸载注册表条目，按 `DisplayName` 做大小写不敏感匹配，版本取 `DisplayVersion`。 | `match` |

`npm test` 会强制校验这个集合。当前目录用到了 `argv`、`pathList`、`registry`、`pip` 和 `npmGlobal`；
`versionFile` 和 `dir` 受支持，但目前没有条目在用。

对 `pathList` 来说：写了 `file` 时 `pattern` 作用在文件内容上，否则作用在命中路径的 basename 上；第一个捕获组就是版本号。
下面两个选项让匹配从"看名字"变成"验内容"，这也是同一个文件夹里放着多个 JDK 时还能认准的原因：

```js
// 有人把 JDK 8 解压进自己的目录——注册表里根本没有它，只能靠它自己的 release 文件认领。
// pattern 钉死主版本，requires 证明它是 JDK 而不是 JRE（JRE 的 release 也写着 1.8，但没有 bin\javac.exe）。
probe: { kind: 'pathList', file: 'release', pattern: 'JAVA_VERSION="(1\\.8[^"]*)"',
  requires: ['bin\\javac.exe'], paths: ['%JAVA_HOME%', '%DRIVES%\\Java\\*', ...] }
```

挑最窄的那种：工具有可用的版本命令就用 `argv`；会自己注册的 GUI 安装包用 `registry`；压缩包和解压出来的 SDK 用
`pathList`；由包管理器装的用 `pip` / `npmGlobal`。

### 可移植路径

没有任何目录条目硬编码盘符或用户路径——写了 `npm test` 就会失败。路径只能走下面几种：

- `%任意环境变量%`，大小写不敏感，`%ProgramFiles(x86)%` 之类都行。变量没设的候选会被**丢掉**而不是瞎猜，
  所以 `%CATALINA_HOME%` 没设时会如实报「未安装」，而不是跑去一个毫无意义的目录里找。
- `%DRIVES%` —— 伪变量，展开成系统盘加上任何实际存在的 `D:`–`H:` 盘。上限是刻意的：逐个字母探测在断开的网络映射上会卡好几秒。
- `%DSH_DEV_ENV_ROOTS%` —— 用户自定义的兜底入口，专门解决「工具被解压到自己建的某个文件夹里」这种情况。
  它展开成 `DSH_DEV_ENV_ROOTS` 环境变量里列出的根目录（分号分隔，去掉结尾的分隔符，空项丢弃）；
  变量没设时贡献零个候选，也就是绝不瞎猜。这是在不改代码的前提下修掉误报的官方办法：

  ```powershell
  # 把你解压到某处的 JDK/IDE/工具目录变得可被发现
  setx DSH_DEV_ENV_ROOTS "D:\Java\tools;E:\sdk"
  ```

  这个值在每次扫描时读取，所以不需要重新构建；但它必须出现在 DSH host 进程的环境里，
  而 `setx` 只对之后启动的进程生效，所以执行完要重启一次 DSH。
- `~` 表示用户主目录。
- 单段的 `*` 和 `?` 通配，一层目录一层目录地展开。展开**刻意不做递归**，所以任何一个目录条目都不可能把一次扫描变成全盘爬取。

### 补齐方案

条目的 `install` 声明会按优先级翻译成可执行方案：

```js
install: {
  winget: 'Git.Git',                          // winget install --id Git.Git -e --accept-* --disable-interactivity
  npm: 'pnpm',                                // npm install -g pnpm
  pip: 'pytest',                              // python -m pip install pytest
  page: 'https://git-scm.com/download/win',   // 打开官方下载页
  note: '会显示在面板里对应行的下方。',
}
```

`winget` 优先，其次 `npm`，再次 `pip`；打开官方下载页是永远可用的兜底。`mode: "auto"` 取第一个非 `page` 的方案。
每个目录条目都必须至少声明一种方式，`npm test` 同样会校验这一点。

### 扫描行为

- 探测 8 路并发；单条命令 12 秒超时；整份清单缓存 60 秒。工具的 `refresh: true` 或 HTTP 的 `?refresh=1` 会强制重扫。
- 卸载注册表每次扫描只读一遍（三个分支一起），之后所有 `registry` 条目共用。
- 全局 npm 根目录每次扫描只问一次；`npm root -g` 答不出来时回落到常见的 `%APPDATA%` / `%ProgramFiles%` 位置。
- Windows 上很多工具是 `.cmd` / `.bat` 垫片（`npm`、`pnpm`、`gradle`、`tsc`……）。Node 18.20+ 起不再直接执行它们，
  所以插件先把真实路径解析出来再交给 `cmd.exe`，并且整行原样传给 `cmd`，保证内层引号不被转义坏。
- 进程启动时快照的 `PATH` 是死的。补齐任务成功收尾后，插件会从注册表重读 Machine 和 User 的 `Path`
  （扫描期间最多每 20 秒刷新一次），所以刚装好的工具不需要重启 DSH 就能被认出来。
- 缺失条目会带一个 `debug` 对象——用了什么探测、实际执行了什么命令、退出码、输出片段——让误报可以被解释，而不是靠猜。

## 实测表现

在参考机器上（Windows 11、DSH 0.2.0-rc.2），用的是当时发布的 68 条目目录：

- 探测到 41 条已安装，全部带精确版本号。
- 探测到 27 条缺失，其中 2 条属于核心必备。
- 从面板发起的 `winget install --id Git.Git` 跑到结束，退出码 0，日志完整流进任务列表。

后来目录扩到了 82 个条目，所以在新的机器上扫描得到的总数会更大。具体数字取决于装了什么。

## 踩坑

下面都是 DSH 本身的行为，这个插件一路踩过来了。贡献者大概率也会撞上。

**host 侧代码只在启动时 import 一次，之后被缓存。** `index.js`、`catalog.js`、`paths.js` 是在 DSH 启动时加载的，
改动它们**必须完整重启 DSH** 才会生效——禁用再启用插件会重新执行 `apply()` 但不会重新 import 模块，改文件名、
卸载再重装也都不会。浏览器半边（`client.js`）不一样：它的 bundle 按文件 mtime 和 size 生成 revision，刷新页面就够了。

**绝对不要在 apply 时用一次性的 `ctx.get('webServer')` 去取 webServer。** 插件可能先于该服务激活，
于是这次调用拿到 `undefined` 而且永不重试：面板能渲染，但所有 `/dsh-dev-env/api/*` 都返回 `404`。
它在「插件安装进一个正在运行的 DSH」时完全正常，到下一次冷启动就坏，因此极难排查。正确做法是等它：

```js
ctx.inject(['webServer'], (scope) => {
  const dispose = scope.webServer.register({ kind: 'exact', path: '/x', handler })
  return () => dispose()
})
```

**`winget` 在受限 shell 里行为不同。** 在 DSH 自己的 host 进程里它是可用的——参考机器上那次 Git 安装就是通过它完成的。
在被沙箱限制或非交互的 shell 里，这个 MSIX 别名可能直接以内部错误码立即失败。面板始终会显示退出码和日志，
而且「下载页」兜底方案不受影响。

**安装器的输出不是按行组织的，把它当按行处理就会毁掉进度。** 进度条是用**裸回车 `\r` 反复重写同一行**画出来的。
只按 `\n` 切分——也就是最直觉的写法——会把每一次重绘粘成一条极长的行，安装器报的百分比其实采到了，但已经没法读。
正确做法是按 `\r` 也切分、剥掉 ANSI 控制序列，并让连续的进度行互相覆盖而不是堆积。另外，
`stdio` 是管道的子进程**不是终端**，所以多数安装器会干脆隐藏动态进度条、只打印阶段行——这就是为什么
面板在解析不出百分比时显示不确定进度，也是为什么"它还活着"这件事由阶段和已用时长来承担。

## 已知限制

- **只支持 Windows。** 没有 macOS 或 Linux 的探测实现。
- **一键补齐会改动本机环境**，并可能弹出 UAC 提权确认。插件通过 UI 征求确认；Agent 只应在用户明确要求时调用 `dev_env_install`。
- GitHub 安装 spec 只用 `git ls-remote` 确认了可达性；bundle 的内容是在取下来之后才校验的，不是之前。
- 目录覆盖的是常见工具链（82 个条目）。装在非常规位置的工具可能需要在 `catalog.js` 里补一条候选路径，或者新增一个条目。
  先试不改代码的办法：把那个目录写进 `DSH_DEV_ENV_ROOTS`，它就会成为用到 `%DSH_DEV_ENV_ROOTS%` 的那些条目的候选
  （JMeter、Tomcat 9/11、禅道、Jenkins）。
- 版本号来自工具自己打印的内容。如果某个程序只在卸载注册表里登记了 build 号（比如 JetBrains 系 IDE），
  面板显示的就是那个 build 号。

## 开发

```powershell
npm test        # node scripts/check.mjs —— 校验目录、路径解析器和打包配置
npm run check   # 同上
```

`npm test` 不需要任何依赖，也不会 spawn 任何进程。它校验目录结构、所有正则能否编译、有没有路径硬编码了盘符或用户目录，
对路径解析器做单元测试，把 `package.json` 和 bundle patch、client 入口、`files[]` 做交叉核对，
并且在 `package.json` 还留着 `cszi666` 发布占位符时拒绝通过。
全部通过时会打印 `all checks passed (82 catalog entries)`。

CI 会对每个 JavaScript 文件跑 `node --check`，然后跑 `npm test`，运行在 `windows-latest` 上，覆盖 Node 18、20、22。

新增目录条目的写法见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

GPL-3.0-or-later，详见 [LICENSE](LICENSE)。
