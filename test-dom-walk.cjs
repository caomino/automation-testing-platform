const { chromium } = require('playwright');

const DOM_WALK = `
(function walk(root) {
  function toNode(el) {
    return { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 200), children: [] };
  }
  const roots = root ? [root] : [document.body];
  return roots.map(toNode);
})
`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://example.com');
  
  try {
    const result = await page.evaluate(({ fn }) => {
      const f = new Function('return ' + fn)();
      return f(null);
    }, { fn: DOM_WALK });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  }
  await browser.close();
})();