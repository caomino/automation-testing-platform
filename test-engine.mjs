// Quick test: direct engine navigation to RuoYi
import { createEngine } from './packages/engine-mcp/src/index.ts';

const engine = createEngine({ engineType: 'direct', headless: true });

try {
  console.log('Launching browser...');
  await engine.launch();
  console.log('Navigating to https://demo.ruoyi.vip ...');
  await engine.navigate('https://demo.ruoyi.vip');
  console.log('Navigated successfully!');
  
  console.log('Extracting DOM...');
  const dom = await engine.extractSemanticDom();
  console.log('DOM nodes:', dom.length);
  
  const flat = [];
  function walk(nodes) {
    for (const n of nodes) {
      flat.push({ tag: n.tag, text: (n.text || '').slice(0, 50), selector: n.selector });
      if (n.children) walk(n.children);
    }
  }
  walk(dom);
  console.log('Total flat nodes:', flat.length);
  console.log('First 10 nodes:');
  flat.slice(0, 10).forEach(n => console.log(`  ${n.tag}: ${n.text} | ${n.selector}`));
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await engine.close().catch(() => {});
}