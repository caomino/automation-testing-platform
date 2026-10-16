/**
 * 可见浏览器 playwright-mcp 服务（长驻，HTTP 模式 —— 对齐 D:/Test 参考实现）。
 * stdio 模式在 Windows 下存在管道死锁（navigate 工具永久挂起，真实事故），故用 HTTP。
 * 浏览器 profile 持久：登录一次后续所有轮次保持会话。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cliPath = (() => {
  try { return require.resolve('@playwright/mcp/package.json').replace(/package\.json$/, 'cli.js') }
  catch { return '@playwright/mcp/cli.js' }
})()

const port = process.env.MCP_PORT ?? '8931'
const args = [cliPath, '--port', port]
// 浏览器二进制：@playwright/mcp 内置 playwright-core 要求的 chromium revision 可能与
// 本机已下载的不一致（真实事故：要 1237 而本机是 1234 → launch 静默失败 → 所有工具挂死）。
// 动态探测 ms-playwright 下最新的 chromium 可执行文件并显式传给 mcp。
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
function findChromiumExecutable() {
  if (process.env.MCP_EXECUTABLE_PATH) return process.env.MCP_EXECUTABLE_PATH
  const base = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright')
  try {
    const dirs = fs.readdirSync(base)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    for (const d of dirs) {
      for (const sub of ['chrome-win64', 'chrome-win']) {
        const exe = path.join(base, d, sub, 'chrome.exe')
        if (fs.existsSync(exe)) return exe
      }
    }
  } catch { /* ignore */ }
  return undefined
}
const exe = findChromiumExecutable()
if (exe) args.push('--executable-path', exe)

// 僵尸侧车清理：旧 server 死后遗留的 chrome 仍持有持久 profile 锁，新 server 启动后
// 首个工具调用会报 "Browser is already in use"（真实事故：引擎半死 → 只导航不点击、
// 任务卡死）。仅当 8931 无存活服务时才清理（有存活服务时绝不误杀）。
async function sidecarAlive() {
  try {
    await fetch(`http://localhost:${port}/mcp`, { method: 'GET', signal: AbortSignal.timeout(1500) })
    return true
  } catch { return false }
}
if (!(await sidecarAlive())) {
  try {
    const { execSync } = await import('node:child_process')
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*ms-playwright*mcp-chrome*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -Confirm:$false }"`,
      { stdio: 'ignore', timeout: 20000 },
    )
    // 等锁释放
    await new Promise((r) => setTimeout(r, 2000))
    console.log('[mcp-sidecar] cleaned stale sidecar chrome (profile lock released)')
  } catch { /* 清理失败不阻断启动 */ }
}

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
  windowsHide: false,
  detached: false,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.once('exit', (code) => process.exit(code ?? 1))
