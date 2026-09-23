/**
 * API 可达性自检（防御性，供各前端入口共用）。
 *
 * 背景：若页面所在地址**没有把 `/api/*` 代理到后端**（典型：一个只做静态托管的端口，
 * 或旧版后端缺新接口），静态服务会把 `/api/...` 当成前端路由回落到 `index.html`
 * （200 + text/html）。此时页面能正常打开，但**任何按钮点了都不会有反应** ——
 * 用户视角就是"点了没反应"，且完全不知道原因。
 *
 * 设计要点（v2，实测教训）：
 * 1. 探测 `/api/store/pending-tree`（人工补录的关键接口）——**不要用 `bootstrap`**：
 *    某些旧入口的 bootstrap 恰好正常，会漏报。
 * 2. **失败后必须重试再判定**：页面打开瞬间可能恰逢后端重启窗口（实测多次踩中），
 *    一次失败就挂横幅会造成"服务明明正常却一直报警"。
 * 3. 横幅出现后**持续自愈复测**：API 恢复后自动移除，避免用户被过期告警困住。
 */

let banner: HTMLDivElement | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let selfCheckTimer: ReturnType<typeof setInterval> | null = null;

const PROBE_URL = '/api/store/pending-tree?systemId=__reachability_probe__';

async function probeOnce(): Promise<boolean> {
  try {
    const res = await fetch(PROBE_URL, { headers: { Accept: 'application/json' } });
    const ct = res.headers.get('content-type') || '';
    return res.ok && ct.includes('application/json');
  } catch {
    return false;
  }
}

function removeBanner() {
  banner?.remove();
  banner = null;
  if (selfCheckTimer) {
    clearInterval(selfCheckTimer);
    selfCheckTimer = null;
  }
}

function showBanner() {
  if (banner) return;
  banner = document.createElement('div');
  banner.setAttribute('data-api-unreachable', '1');
  banner.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'top:0',
    'z-index:99999',
    'background:#b91c1c',
    'color:#fff',
    'padding:10px 16px',
    'font:13px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif',
    'text-align:center',
    'box-shadow:0 2px 8px rgba(0,0,0,.25)',
  ].join(';');
  banner.innerHTML =
    '⚠️ <b>当前地址的后端接口不完整</b>——页面能打开，但<b>「入树」等操作点了不会有反应</b>。<br>' +
    '请改用带完整接口代理的地址：<b>http://localhost:5173</b>';
  document.body.appendChild(bar_guard(banner));

  // 自愈：每 30s 复测，API 恢复则自动移除横幅（避免过期告警常驻）
  selfCheckTimer = setInterval(async () => {
    if (await probeOnce()) removeBanner();
  }, 30_000);
}

/** body 可能尚未挂载（入口在 render 前调用），兜底挂到 documentElement */
function bar_guard(el: HTMLDivElement): HTMLDivElement {
  return (document.body || document.documentElement).appendChild(el);
}

/**
 * 启动时调用。失败重试 3 次（间隔 2s）仍不通才显示横幅；
 * 之后每 30s 自愈复测，恢复即自动移除。
 */
export async function warnIfApiUnreachable(): Promise<boolean> {
  // 重试窗口：3 次 × 2s（页面打开瞬间恰逢后端重启是常态，不能一次失败就报警）
  for (let i = 0; i < 3; i++) {
    if (await probeOnce()) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }

  showBanner();
  // 横幅已显示，仍保持低频自愈（showBanner 内已启动 interval）

  // 首次自愈尝试不要等 30s：5s 后先试一次，成功立即撤
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(async () => {
    if (await probeOnce()) removeBanner();
  }, 5000);
  return false;
}
