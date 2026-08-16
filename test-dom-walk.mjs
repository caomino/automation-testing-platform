import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto('https://demo.ruoyi.vip/login', { waitUntil: 'load' });
await page.waitForTimeout(3000);

const inputs = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('input'));
  return all.map(i => ({
    tag: i.tagName,
    type: i.type,
    name: i.name,
    placeholder: i.placeholder,
    visible: (() => {
      const s = window.getComputedStyle(i);
      const r = i.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    })()
  }));
});

console.log('All inputs on page:');
for (const inp of inputs) {
  console.log(`  <${inp.tag}> type="${inp.type}" name="${inp.name}" placeholder="${inp.placeholder}" visible=${inp.visible}`);
}

// Now test DOM_WALK's toNode behavior
const domNodes = await page.evaluate(() => {
  const interactiveTags = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA']);
  const containerTags = new Set(['DIV','SECTION','ASIDE','NAV','UL','OL','LI','FORM','TABLE','HEADER','FOOTER','MAIN','ARTICLE']);
  
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  
  function toNode(el) {
    const tag = el.tagName;
    const text = (el.textContent || '').trim().slice(0, 200);
    const type = el.getAttribute('type') || undefined;
    const name = el.getAttribute('name') || undefined;
    const placeholder = el.getAttribute('placeholder') || undefined;
    const r = el.getBoundingClientRect();
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const interactive = interactiveTags.has(tag) || !!el.getAttribute('role') || el.onclick != null;
    const node = {
      tag, text: text || undefined, name: name || undefined,
      type: type || undefined, placeholder,
      children: [], rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      interactive, isDataControl: isInput,
    };
    for (const child of el.children) {
      if (child.nodeType === 1 && isVisible(child)) {
        const cn = toNode(child);
        if (cn.interactive || containerTags.has(cn.tag) || cn.children.length) node.children.push(cn);
      }
    }
    return node;
  }
  
  const body = document.body;
  const root = toNode(body);
  
  function collectInputs(node, out) {
    if (node.tag === 'INPUT' || node.tag === 'TEXTAREA' || node.tag === 'SELECT') {
      out.push({
        tag: node.tag, type: node.type, name: node.name,
        placeholder: node.placeholder, text: node.text,
        interactive: node.interactive, isDataControl: node.isDataControl
      });
    }
    for (const child of node.children) collectInputs(child, out);
  }
  
  const inputNodes = [];
  collectInputs(root, inputNodes);
  return inputNodes;
});

console.log('\nDOM_WALK extracted input nodes:');
for (const n of domNodes) {
  console.log(`  <${n.tag}> type="${n.type}" name="${n.name}" placeholder="${n.placeholder}" text="${(n.text || '').substring(0, 30)}" interactive=${n.interactive}`);
}

// Now test the detectLoginState logic
const textOf = (n) => `${n.text ?? ''} ${n.name ?? ''} ${n.placeholder ?? ''}`;
const hasCaptcha = domNodes.some((n) => /captcha|验证码|滑块|拼图|slide[- ]?verify|rotate|校验码/i.test(textOf(n)));
const hasCaptchaInput = domNodes.some((n) => n.tag === 'INPUT' && n.type !== 'password' && /code|captcha|verify|valid|check/i.test(`${n.name ?? ''} ${n.placeholder ?? ''}`));
const hasPasswordField = domNodes.some((n) => n.tag === 'INPUT' && n.type === 'password');
const loggedInSignal = domNodes.some((n) => /退出登录|注销|个人中心|dashboard|控制台|工作台|系统管理/i.test(textOf(n)));

console.log('\n--- detectLoginState analysis ---');
console.log('hasCaptcha:', hasCaptcha);
console.log('hasCaptchaInput:', hasCaptchaInput);
console.log('hasPasswordField:', hasPasswordField);
console.log('loggedInSignal:', loggedInSignal);
console.log('Would return:', hasCaptcha || hasCaptchaInput ? 'barrier (captcha detected)' : hasPasswordField && !loggedInSignal ? 'barrier (login form visible)' : loggedInSignal ? 'ok' : 'check further');

await browser.close();