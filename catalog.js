/**
 * dsh-dev-env — machine-independent toolchain catalog.
 *
 * Every entry is one "slot" the scanner can probe:
 *   probe   — how to tell whether it is installed, and which version
 *   install — how to fill the gap (winget / npm / pip / official download page)
 *
 * IMPORTANT: no entry may hardcode a machine-specific absolute path. Anything that
 * needs a location goes through `%ENV_VAR%`, `~`, `*` globs, or the Windows uninstall
 * registry, so the same catalog works on a fresh machine.
 *
 * probe kinds
 *   argv         run a command, extract the version from stdout+stderr with `pattern`
 *   versionFile  read one exact file, extract the version with `pattern`
 *   pathList     first existing candidate from an ordered, env-expanded, glob-aware list
 *   dir          a file or directory exists at the env-expanded path
 *   pip          `python -m pip show <module>`
 *   npmGlobal    a package under the global npm root (`npm root -g`)
 *   registry     a Windows uninstall-registry entry (`DisplayName` / `DisplayVersion`)
 *
 * pathList options
 *   paths    ordered candidates. `%VAR%` (any environment variable, case-insensitive),
 *            `~` (user home) and `*` (exactly one path segment) are expanded.
 *            Two pseudo-variables stand for more than one root:
 *              %DRIVES%             the system drive plus any existing D:–H: drive
 *              %DSH_DEV_ENV_ROOTS%  whatever the user listed in that env var
 *                                   (semicolon separated) — the escape hatch for tools
 *                                   unzipped into a folder of their own.
 *   file     optional file inside the matched directory; the candidate only counts
 *            when that file exists.
 *   pattern  optional regex. With `file` it is applied to the file content, otherwise
 *            to the matched path's basename. The first capture group (or the whole
 *            match) becomes the version.
 *   prefix / suffix  decoration around the extracted version.
 *
 * `essential: true` marks the entries counted in the "essential gaps" summary.
 */

export const CATEGORIES = [
  { id: 'language', name: '语言 / 运行时', nameEn: 'Languages & runtimes', order: 10 },
  { id: 'ide', name: 'IDE / 编辑器', nameEn: 'IDEs & editors', order: 20 },
  { id: 'test', name: '测试工具', nameEn: 'Testing tools', order: 30 },
  { id: 'data', name: '数据库 / 中间件 / CI', nameEn: 'Databases, middleware & CI', order: 40 },
  { id: 'tool', name: '构建与命令行工具', nameEn: 'Build & CLI tools', order: 50 },
]

// DevEco Studio (HarmonyOS) lands in different places depending on how it was installed,
// so the candidates cover the usual installers instead of one hardcoded drive.
const DEVECO_ROOTS = [
  '%ProgramFiles%\\Huawei\\DevEco Studio',
  '%ProgramFiles(x86)%\\Huawei\\DevEco Studio',
  '%LOCALAPPDATA%\\Huawei\\DevEco Studio',
  '%LOCALAPPDATA%\\Programs\\Huawei\\DevEco Studio',
  '%USERPROFILE%\\DevEco Studio',
  '%USERPROFILE%\\HarmonyOS\\DevEco Studio',
  '%DRIVES%\\HarmonyOS\\DevEco Studio',
]
const appendPath = (roots, suffix) => roots.map((root) => `${root}${suffix}`)
const DEVECO_PARENTS = DEVECO_ROOTS.map((root) => root.replace(/\\DevEco Studio$/, ''))

export const CATALOG = [
  // ---------------------------------------------------------------- languages & runtimes
  { id: 'java', name: 'Java (JDK)', category: 'language', essential: true,
    probe: { kind: 'argv', argv: ['java', '-version'], pattern: 'version "([^"]+)"' },
    install: { winget: 'EclipseAdoptium.Temurin.21.JDK', page: 'https://adoptium.net/temurin/releases/' } },

  { id: 'javac', name: 'javac 编译器', nameEn: 'javac compiler', category: 'language',
    probe: { kind: 'argv', argv: ['javac', '-version'], pattern: 'javac ([\\d._]+)' },
    install: { winget: 'EclipseAdoptium.Temurin.21.JDK', page: 'https://adoptium.net/temurin/releases/' } },

  { id: 'jdk8', name: 'JDK 8', category: 'language',
    // Legacy projects still need 8, and a JDK 8 copied into a folder of your own is
    // registered nowhere — so this probe is content-validated instead of name-matched:
    //   pattern  the folder's own `release` file must say 1.8.x, so a JDK 11 sitting in the
    //            same collection folder is never reported as 8 (a bare JAVA_VERSION pattern
    //            would happily match any version);
    //   requires bin\javac.exe must exist, so a JRE 8 is not labelled as a JDK.
    probe: { kind: 'pathList', file: 'release', pattern: 'JAVA_VERSION="(1\\.8[^"]*)"',
      requires: ['bin\\javac.exe'],
      paths: [
        '%JAVA_HOME%',
        '%ProgramFiles%\\Eclipse Adoptium\\jdk-8*',
        '%ProgramFiles%\\Amazon Corretto\\jdk1.8*',
        '%ProgramFiles%\\Java\\jdk1.8*',
        '%ProgramFiles%\\Zulu\\zulu-8*',
        '%ProgramFiles%\\Microsoft\\jdk-8*',
        '%ProgramFiles%\\BellSoft\\LibericaJDK-8*',
        '%LOCALAPPDATA%\\Programs\\Eclipse Adoptium\\jdk-8*',
        '%USERPROFILE%\\.jdks\\*',
        '%DRIVES%\\Java\\*',
        '%DRIVES%\\jdk\\*',
        '%DRIVES%\\jdk1.8*',
        '%DSH_DEV_ENV_ROOTS%\\*',
      ] },
    install: { winget: 'EclipseAdoptium.Temurin.8.JDK', page: 'https://adoptium.net/temurin/releases/?version=8' } },

  { id: 'python', name: 'Python', category: 'language', essential: true,
    probe: { kind: 'argv', argv: ['python', '--version'], pattern: 'Python ([\\d.]+)' },
    install: { winget: 'Python.Python.3.12', page: 'https://www.python.org/downloads/windows/' } },

  { id: 'python3', name: 'Python 3 (python3)', category: 'language',
    probe: { kind: 'argv', argv: ['python3', '--version'], pattern: 'Python ([\\d.]+)' },
    install: { winget: 'Python.Python.3.12', page: 'https://www.python.org/downloads/windows/' } },

  { id: 'python-launcher', name: 'Python Launcher (py)', category: 'language',
    probe: { kind: 'argv', argv: ['py', '--version'], pattern: 'Python ([\\d.]+)' },
    install: { winget: 'Python.Python.3.12', page: 'https://www.python.org/downloads/windows/' } },

  { id: 'pip', name: 'pip 包管理器', nameEn: 'pip package manager', category: 'language', essential: true,
    probe: { kind: 'argv', argv: ['python', '-m', 'pip', '--version'], pattern: 'pip ([\\d.]+)' },
    install: { page: 'https://pip.pypa.io/en/stable/installation/' } },

  { id: 'conda', name: 'Anaconda / conda', category: 'language',
    probe: { kind: 'argv', argv: ['conda', '--version'], pattern: 'conda ([\\d.]+)' },
    install: { winget: 'Anaconda.Anaconda3', page: 'https://www.anaconda.com/download' } },

  { id: 'nodejs', name: 'Node.js', category: 'language', essential: true,
    probe: { kind: 'argv', argv: ['node', '--version'], pattern: 'v([\\d.]+)' },
    install: { winget: 'OpenJS.NodeJS.LTS', page: 'https://nodejs.org/en/download' } },

  { id: 'npm', name: 'npm', category: 'language',
    probe: { kind: 'argv', argv: ['npm', '--version'], pattern: '([\\d.]+)' },
    install: { winget: 'OpenJS.NodeJS.LTS', page: 'https://nodejs.org/en/download' } },

  { id: 'pnpm', name: 'pnpm', category: 'language',
    probe: { kind: 'argv', argv: ['pnpm', '--version'], pattern: '([\\d.]+)' },
    install: { npm: 'pnpm', page: 'https://pnpm.io/installation' } },

  { id: 'yarn', name: 'Yarn', category: 'language',
    probe: { kind: 'argv', argv: ['yarn', '--version'], pattern: '([\\d.]+)' },
    install: { npm: 'yarn', page: 'https://classic.yarnpkg.com/lang/en/docs/install/' } },

  { id: 'dotnet', name: '.NET SDK', category: 'language',
    probe: { kind: 'argv', argv: ['dotnet', '--version'], pattern: '([\\d]+\\.[\\d]+\\.[\\d]+)' },
    install: { winget: 'Microsoft.DotNet.SDK.8', page: 'https://dotnet.microsoft.com/download' } },

  { id: 'go', name: 'Go', category: 'language',
    probe: { kind: 'argv', argv: ['go', 'version'], pattern: 'go([\\d.]+)' },
    install: { winget: 'GoLang.Go', page: 'https://go.dev/dl/' } },

  { id: 'rust', name: 'Rust (rustc)', category: 'language',
    probe: { kind: 'argv', argv: ['rustc', '--version'], pattern: 'rustc ([\\d.]+)' },
    install: { winget: 'Rustlang.Rustup', page: 'https://www.rust-lang.org/tools/install' } },

  { id: 'ruby', name: 'Ruby', category: 'language',
    probe: { kind: 'argv', argv: ['ruby', '--version'], pattern: 'ruby ([\\d.]+)' },
    install: { winget: 'RubyInstallerTeam.Ruby.3.3', page: 'https://rubyinstaller.org/downloads/' } },

  { id: 'php', name: 'PHP', category: 'language',
    probe: { kind: 'argv', argv: ['php', '--version'], pattern: 'PHP ([\\d.]+)' },
    install: { winget: 'PHP.PHP', page: 'https://windows.php.net/download/' } },

  { id: 'typescript', name: 'TypeScript (tsc)', category: 'language',
    probe: { kind: 'argv', argv: ['tsc', '--version'], pattern: 'Version ([\\d.]+)' },
    install: { npm: 'typescript', page: 'https://www.typescriptlang.org/download' } },

  { id: 'deno', name: 'Deno', category: 'language',
    probe: { kind: 'argv', argv: ['deno', '--version'], pattern: 'deno ([\\d.]+)' },
    install: { winget: 'DenoLand.Deno', page: 'https://deno.com/' } },

  { id: 'gcc', name: 'GCC (MinGW-w64)', category: 'language', essential: true,
    probe: { kind: 'argv', argv: ['gcc', '--version'], pattern: '(\\d+\\.\\d+\\.\\d+)' },
    install: { winget: 'BrechtSanders.WinLibs.POSIX.UCRT', page: 'https://winlibs.com/',
      note: 'WinLibs 解压即用；想要整套 POSIX 工具链就装 MSYS2.MSYS2' } },

  { id: 'gpp', name: 'G++ (C++ 前端)', nameEn: 'G++ (C++ frontend)', category: 'language',
    probe: { kind: 'argv', argv: ['g++', '--version'], pattern: '(\\d+\\.\\d+\\.\\d+)' },
    install: { winget: 'BrechtSanders.WinLibs.POSIX.UCRT', page: 'https://winlibs.com/' } },

  { id: 'clang', name: 'Clang / LLVM', category: 'language',
    probe: { kind: 'argv', argv: ['clang', '--version'], pattern: 'clang version ([\\d.]+)' },
    install: { winget: 'LLVM.LLVM', page: 'https://releases.llvm.org/' } },

  { id: 'gdb', name: 'GDB 调试器', nameEn: 'GDB debugger', category: 'language',
    probe: { kind: 'argv', argv: ['gdb', '--version'], pattern: 'GNU gdb[^\\d]*([\\d.]+)' },
    install: { winget: 'MSYS2.MSYS2', page: 'https://www.msys2.org/' } },

  // ---------------------------------------------------------------- IDEs & editors
  { id: 'idea', name: 'IntelliJ IDEA', category: 'ide',
    probe: { kind: 'registry', match: 'IntelliJ IDEA' },
    install: { winget: 'JetBrains.IntelliJIDEA.Ultimate', page: 'https://www.jetbrains.com/idea/download/' } },

  { id: 'pycharm', name: 'PyCharm', category: 'ide',
    probe: { kind: 'registry', match: 'PyCharm' },
    install: { winget: 'JetBrains.PyCharm.Professional', page: 'https://www.jetbrains.com/pycharm/download/' } },

  { id: 'webstorm', name: 'WebStorm', category: 'ide',
    probe: { kind: 'registry', match: 'WebStorm' },
    install: { winget: 'JetBrains.WebStorm', page: 'https://www.jetbrains.com/webstorm/download/' } },

  { id: 'goland', name: 'GoLand', category: 'ide',
    probe: { kind: 'registry', match: 'GoLand' },
    install: { winget: 'JetBrains.GoLand', page: 'https://www.jetbrains.com/go/download/' } },

  { id: 'clion', name: 'CLion', category: 'ide',
    probe: { kind: 'registry', match: 'CLion' },
    install: { winget: 'JetBrains.CLion', page: 'https://www.jetbrains.com/clion/download/' } },

  { id: 'jetbrains-toolbox', name: 'JetBrains Toolbox', category: 'ide',
    probe: { kind: 'registry', match: 'JetBrains Toolbox' },
    install: { winget: 'JetBrains.Toolbox', page: 'https://www.jetbrains.com/toolbox-app/' } },

  { id: 'vscode', name: 'Visual Studio Code', category: 'ide', essential: true,
    probe: { kind: 'registry', match: 'Visual Studio Code' },
    install: { winget: 'Microsoft.VisualStudioCode', page: 'https://code.visualstudio.com/Download' } },

  { id: 'cursor', name: 'Cursor', category: 'ide',
    probe: { kind: 'registry', match: 'Cursor' },
    install: { winget: 'Anysphere.Cursor', page: 'https://cursor.com/' } },

  { id: 'visualstudio', name: 'Visual Studio 2022+', category: 'ide',
    probe: { kind: 'registry', match: 'Visual Studio (Community|Professional|Enterprise|BuildTools)' },
    install: { winget: 'Microsoft.VisualStudio.2022.Community', page: 'https://visualstudio.microsoft.com/downloads/' } },

  { id: 'eclipse', name: 'Eclipse IDE', category: 'ide',
    probe: { kind: 'pathList', pattern: '(?:eclipse-java-|java-|jee-)?(\\d{4}-\\d{2})',
      paths: ['%USERPROFILE%\\eclipse\\*', '%ProgramFiles%\\Eclipse\\*',
        '%LOCALAPPDATA%\\Programs\\Eclipse\\*', '%USERPROFILE%\\eclipse\\java-*'] },
    install: { winget: 'EclipseFoundation.Eclipse.Java', page: 'https://www.eclipse.org/downloads/' } },

  { id: 'deveco', name: 'DevEco Studio (鸿蒙)', nameEn: 'DevEco Studio (HarmonyOS)', category: 'ide',
    probe: { kind: 'pathList', pattern: '"version"\\s*:\\s*"([\\d.]+)"',
      paths: DEVECO_ROOTS.map((root) => `${root}\\product-info.json`) },
    install: { page: 'https://developer.huawei.com/consumer/cn/deveco-studio/' } },

  { id: 'harmony-sdk', name: 'HarmonyOS SDK (API)', category: 'ide',
    probe: { kind: 'pathList', prefix: 'API ', pattern: '"apiVersion"\\s*:\\s*"(\\d+)"',
      paths: DEVECO_ROOTS.map((root) => `${root}\\sdk\\default\\openharmony\\ets\\oh-uni-package.json`) },
    install: { page: 'https://developer.huawei.com/consumer/cn/deveco-studio/' } },

  { id: 'harmony-native', name: 'HarmonyOS Native SDK', category: 'ide',
    probe: { kind: 'pathList', paths: appendPath(DEVECO_ROOTS, '\\sdk\\default\\openharmony\\native') },
    install: { page: 'https://developer.huawei.com/consumer/cn/deveco-studio/' } },

  { id: 'deveco-testing', name: 'DevEco Testing', category: 'ide',
    probe: { kind: 'pathList', paths: appendPath(DEVECO_PARENTS, '\\DevEco Testing') },
    install: { page: 'https://developer.huawei.com/consumer/cn/deveco-studio/' } },

  { id: 'android-studio', name: 'Android Studio', category: 'ide',
    probe: { kind: 'registry', match: 'Android Studio' },
    install: { winget: 'Google.AndroidStudio', page: 'https://developer.android.google.cn/studio' } },

  { id: 'wechat-devtool', name: '微信开发者工具', nameEn: 'WeChat DevTools', category: 'ide',
    probe: { kind: 'registry', match: '微信开发者工具|WeChat DevTools' },
    install: { page: 'https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html' } },

  { id: 'notepadpp', name: 'Notepad++', category: 'ide',
    probe: { kind: 'pathList', paths: ['%ProgramFiles%\\Notepad++', '%ProgramFiles(x86)%\\Notepad++'] },
    install: { winget: 'Notepad++.Notepad++', page: 'https://sourceforge.net/projects/notepad-plus/' } },

  { id: 'sublime', name: 'Sublime Text', category: 'ide',
    probe: { kind: 'registry', match: 'Sublime Text' },
    install: { winget: 'SublimeHQ.SublimeText.4', page: 'https://www.sublimetext.com/download' } },

  { id: 'dbeaver', name: 'DBeaver', category: 'ide',
    probe: { kind: 'registry', match: 'DBeaver' },
    install: { winget: 'dbeaver.dbeaver', page: 'https://dbeaver.io/download/' } },

  { id: 'neovim', name: 'Neovim', category: 'ide',
    probe: { kind: 'argv', argv: ['nvim', '--version'], pattern: 'NVIM v([\\d.]+)' },
    install: { winget: 'Neovim.Neovim', page: 'https://neovim.io/' } },

  // ---------------------------------------------------------------- testing tools
  { id: 'jmeter', name: 'Apache JMeter', category: 'test', essential: true,
    probe: { kind: 'pathList', pattern: 'apache-jmeter-([\\d.]+)',
      paths: ['%USERPROFILE%\\apache-jmeter-*', '%LOCALAPPDATA%\\Programs\\apache-jmeter-*',
        '%ProgramFiles%\\apache-jmeter-*', '%ProgramData%\\apache-jmeter-*',
        '%DRIVES%\\apache-jmeter-*', '%DRIVES%\\Tools\\apache-jmeter-*',
        '%DSH_DEV_ENV_ROOTS%\\apache-jmeter-*'] },
    install: { winget: 'Apache.JMeter', page: 'https://jmeter.apache.org/download_jmeter.cgi' } },

  { id: 'zentao', name: '禅道 ZenTao', nameEn: 'ZenTao', category: 'test',
    probe: { kind: 'pathList', file: 'app\\zentao\\VERSION', pattern: '([\\d.]+)',
      paths: ['%USERPROFILE%\\chandao\\ZenTao', '%USERPROFILE%\\ZenTao', '%ProgramData%\\ZenTao',
        '%DRIVES%\\chandao\\ZenTao', '%DRIVES%\\ZenTao', '%DSH_DEV_ENV_ROOTS%\\ZenTao',
        '%DSH_DEV_ENV_ROOTS%\\chandao\\ZenTao'] },
    install: { page: 'https://www.zentao.net/download.html' } },

  { id: 'postman', name: 'Postman', category: 'test',
    probe: { kind: 'registry', match: 'Postman' },
    install: { winget: 'Postman.Postman', page: 'https://www.postman.com/downloads/' } },

  { id: 'insomnia', name: 'Insomnia', category: 'test',
    probe: { kind: 'registry', match: 'Insomnia' },
    install: { winget: 'Insomnia.Insomnia', page: 'https://insomnia.rest/download' } },

  { id: 'newman', name: 'Newman (Postman CLI)', category: 'test',
    probe: { kind: 'npmGlobal', name: 'newman' },
    install: { npm: 'newman', page: 'https://www.npmjs.com/package/newman' } },

  { id: 'pytest', name: 'pytest', category: 'test', essential: true,
    probe: { kind: 'pip', module: 'pytest' },
    install: { pip: 'pytest', page: 'https://docs.pytest.org/' } },

  { id: 'selenium', name: 'Selenium (Python)', category: 'test',
    probe: { kind: 'pip', module: 'selenium' },
    install: { pip: 'selenium', page: 'https://www.selenium.dev/documentation/' } },

  { id: 'playwright', name: 'Playwright (Python)', category: 'test',
    probe: { kind: 'pip', module: 'playwright' },
    install: { pip: 'playwright', page: 'https://playwright.dev/python/' } },

  { id: 'requests', name: 'requests (接口测试)', nameEn: 'requests (HTTP testing)', category: 'test',
    probe: { kind: 'pip', module: 'requests' },
    install: { pip: 'requests', page: 'https://requests.readthedocs.io/' } },

  { id: 'locust', name: 'Locust 压测', nameEn: 'Locust (load testing)', category: 'test',
    probe: { kind: 'pip', module: 'locust' },
    install: { pip: 'locust', page: 'https://locust.io/' } },

  { id: 'allure', name: 'Allure 报告', nameEn: 'Allure report', category: 'test',
    probe: { kind: 'argv', argv: ['allure', '--version'], pattern: '([\\d.]+)' },
    install: { winget: 'Qameta.Allure', page: 'https://allurereport.org/' } },

  { id: 'appium', name: 'Appium (移动端自动化)', nameEn: 'Appium (mobile automation)', category: 'test',
    probe: { kind: 'argv', argv: ['appium', '--version'], pattern: '([\\d.]+)' },
    install: { npm: 'appium', page: 'https://appium.io/docs/en/latest/' } },

  { id: 'junit', name: 'JUnit (本地 Maven/Gradle 仓库)', nameEn: 'JUnit (local Maven/Gradle cache)', category: 'test',
    probe: { kind: 'pathList', paths: ['%USERPROFILE%\\.m2\\repository\\junit',
      '%USERPROFILE%\\.gradle\\caches\\modules-2\\files-2.1\\junit'] },
    install: { page: 'https://junit.org/junit5/' } },

  { id: 'adb', name: 'Android platform-tools (adb)', category: 'test',
    probe: { kind: 'pathList', paths: [
      '%ANDROID_HOME%\\platform-tools', '%ANDROID_SDK_ROOT%\\platform-tools',
      '%LOCALAPPDATA%\\Android\\Sdk\\platform-tools',
      '%USERPROFILE%\\AppData\\Local\\Android\\Sdk\\platform-tools',
      '%ProgramFiles%\\Android\\platform-tools',
    ] },
    install: { page: 'https://developer.android.google.cn/tools/releases/platform-tools' } },

  { id: 'fiddler', name: 'Fiddler 抓包', nameEn: 'Fiddler (traffic capture)', category: 'test',
    probe: { kind: 'registry', match: 'Fiddler' },
    install: { winget: 'Telerik.Fiddler.Classic', page: 'https://www.telerik.com/download/fiddler' } },

  { id: 'wireshark', name: 'Wireshark', category: 'test',
    probe: { kind: 'registry', match: 'Wireshark' },
    install: { winget: 'WiresharkFoundation.Wireshark', page: 'https://www.wireshark.org/download.html' } },

  // ---------------------------------------------------------------- databases, middleware & CI
  { id: 'mysql', name: 'MySQL Server', category: 'data',
    probe: { kind: 'registry', match: 'MySQL Server' },
    install: { winget: 'Oracle.MySQL', page: 'https://dev.mysql.com/downloads/mysql/' } },

  { id: 'postgresql', name: 'PostgreSQL', category: 'data',
    probe: { kind: 'registry', match: 'PostgreSQL' },
    install: { winget: 'PostgreSQL.PostgreSQL.16', page: 'https://www.postgresql.org/download/windows/' } },

  { id: 'navicat', name: 'Navicat Premium', category: 'data',
    probe: { kind: 'registry', match: 'Navicat Premium' },
    install: { page: 'https://www.navicat.com/en/download/navicat-premium' } },

  { id: 'sqlserver-localdb', name: 'SQL Server LocalDB', category: 'data',
    probe: { kind: 'registry', match: 'SQL Server .* LocalDB' },
    install: { winget: 'Microsoft.SQLServer.2019.LocalDB', page: 'https://learn.microsoft.com/sql/database-engine/configure-windows/sql-server-express-localdb' } },

  { id: 'mongodb', name: 'MongoDB', category: 'data',
    probe: { kind: 'registry', match: 'MongoDB' },
    install: { winget: 'MongoDB.Server', page: 'https://www.mongodb.com/try/download/community' } },

  { id: 'redis', name: 'Redis', category: 'data',
    probe: { kind: 'argv', argv: ['redis-server', '--version'], pattern: 'v=([\\d.]+)' },
    install: { winget: 'tporadowski.Redis', page: 'https://redis.io/downloads/' } },

  { id: 'tomcat9', name: 'Apache Tomcat 9', category: 'data',
    probe: { kind: 'pathList', pattern: 'Apache Tomcat Version ([\\d.]+)', paths: [
      '%CATALINA_HOME%\\RELEASE-NOTES',
      '%ProgramFiles%\\Apache Software Foundation\\Tomcat 9.0\\RELEASE-NOTES',
      '%ProgramFiles(x86)%\\Apache Software Foundation\\Tomcat 9.0\\RELEASE-NOTES',
      '%DRIVES%\\Tomcat9\\RELEASE-NOTES', '%DRIVES%\\Tomcat\\RELEASE-NOTES',
      '%DSH_DEV_ENV_ROOTS%\\Tomcat9\\RELEASE-NOTES', '%DSH_DEV_ENV_ROOTS%\\Tomcat\\RELEASE-NOTES',
    ] },
    install: { winget: 'Apache.Tomcat.9', page: 'https://tomcat.apache.org/download-90.cgi' } },

  { id: 'tomcat11', name: 'Apache Tomcat 11', category: 'data',
    probe: { kind: 'pathList', pattern: 'Apache Tomcat Version ([\\d.]+)', paths: [
      '%ProgramFiles%\\Apache Software Foundation\\Tomcat 11.0\\RELEASE-NOTES',
      '%ProgramFiles(x86)%\\Apache Software Foundation\\Tomcat 11.0\\RELEASE-NOTES',
      '%DRIVES%\\Tomcat11\\RELEASE-NOTES',
      '%DSH_DEV_ENV_ROOTS%\\Tomcat11\\RELEASE-NOTES', '%DSH_DEV_ENV_ROOTS%\\Tomcat\\RELEASE-NOTES',
    ] },
    install: { winget: 'Apache.Tomcat.11', page: 'https://tomcat.apache.org/download-11.cgi' } },

  { id: 'jenkins', name: 'Jenkins', category: 'data',
    probe: { kind: 'pathList', paths: ['%ProgramFiles%\\Jenkins', '%ProgramData%\\Jenkins',
      '%LOCALAPPDATA%\\Jenkins', '%DRIVES%\\Jenkins', '%USERPROFILE%\\Jenkins',
      '%DSH_DEV_ENV_ROOTS%\\Jenkins'] },
    install: { winget: 'Jenkins.Jenkins', page: 'https://www.jenkins.io/download/' } },

  { id: 'docker', name: 'Docker', category: 'data',
    probe: { kind: 'argv', argv: ['docker', '--version'], pattern: 'version ([\\d.]+)' },
    install: { winget: 'Docker.DockerDesktop', page: 'https://www.docker.com/products/docker-desktop/' } },

  // ---------------------------------------------------------------- build & CLI tools
  { id: 'git', name: 'Git', category: 'tool', essential: true,
    probe: { kind: 'argv', argv: ['git', '--version'], pattern: 'git version (\\S+)' },
    install: { winget: 'Git.Git', page: 'https://git-scm.com/download/win' } },

  { id: 'cmake', name: 'CMake', category: 'tool', essential: true,
    probe: { kind: 'argv', argv: ['cmake', '--version'], pattern: 'cmake version ([\\d.]+)' },
    install: { winget: 'Kitware.CMake', page: 'https://cmake.org/download/' } },

  { id: 'ninja', name: 'Ninja 构建系统', nameEn: 'Ninja build system', category: 'tool',
    probe: { kind: 'argv', argv: ['ninja', '--version'], pattern: '([\\d.]+)' },
    install: { winget: 'Ninja-build.Ninja', page: 'https://ninja-build.org/' } },

  { id: 'make', name: 'GNU Make', category: 'tool',
    probe: { kind: 'argv', argv: ['make', '--version'], pattern: 'GNU Make ([\\d.]+)' },
    install: { winget: 'MSYS2.MSYS2', page: 'https://www.msys2.org/' } },

  { id: 'maven', name: 'Apache Maven', category: 'tool',
    probe: { kind: 'argv', argv: ['mvn', '-v'], pattern: 'Apache Maven ([\\d.]+)' },
    install: { winget: 'Apache.Maven', page: 'https://maven.apache.org/download.cgi' } },

  { id: 'gradle', name: 'Gradle', category: 'tool',
    probe: { kind: 'argv', argv: ['gradle', '--version'], pattern: 'Gradle ([\\d.]+)' },
    install: { winget: 'Gradle.Gradle', page: 'https://gradle.org/releases/' } },

  { id: 'winget', name: 'winget (Windows 包管理器)', nameEn: 'winget (Windows package manager)', category: 'tool', essential: true,
    probe: { kind: 'argv', argv: ['winget', '--version'], pattern: 'v?([\\d.]+)' },
    install: { page: 'https://apps.microsoft.com/detail/9nblggh4nns1' } },

  { id: 'scoop', name: 'Scoop', category: 'tool',
    probe: { kind: 'argv', argv: ['scoop', '--version'], pattern: 'v?([\\d.]+)' },
    install: { page: 'https://scoop.sh/' } },

  { id: 'choco', name: 'Chocolatey', category: 'tool',
    probe: { kind: 'argv', argv: ['choco', '--version'], pattern: '([\\d.]+)' },
    install: { page: 'https://chocolatey.org/install' } },

  { id: 'curl', name: 'curl', category: 'tool',
    probe: { kind: 'argv', argv: ['curl.exe', '--version'], pattern: 'curl ([\\d.]+)' },
    install: { winget: 'cURL.cURL', page: 'https://curl.se/windows/' } },

  { id: 'gh', name: 'GitHub CLI (gh)', category: 'tool',
    probe: { kind: 'argv', argv: ['gh', '--version'], pattern: 'gh version ([\\d.]+)' },
    install: { winget: 'GitHub.cli', page: 'https://cli.github.com/' } },

  { id: 'sevenzip', name: '7-Zip', category: 'tool',
    probe: { kind: 'registry', match: '7-Zip' },
    install: { winget: '7zip.7zip', page: 'https://www.7-zip.org/download.html' } },

  { id: 'wsl', name: 'WSL (Linux 子系统)', nameEn: 'WSL (Linux subsystem)', category: 'tool',
    probe: { kind: 'argv', argv: ['wsl', '-l', '-v'] },
    install: { winget: 'Microsoft.WSL', page: 'https://learn.microsoft.com/windows/wsl/install' } },
]
