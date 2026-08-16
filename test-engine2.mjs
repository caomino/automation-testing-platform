// Quick test: check new DOM_WALK output
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
  console.log('Root modules:', dom.length);
  
  const flat = [];
  function walk(nodes, depth = 0) {
    for (const n of nodes) {
      flat.push({ tag: n.tag, text: (n.text || '').slice(0, 50), selector: n.selector, depth });
      if (n.children) walk(n.children, depth + 1);
    }
  }
  walk(dom);
  console.log('Total flat nodes:', flat.length);
  console.log('Top-level modules:');
  dom.forEach((n, i) => console.log(`  [${i}] ${n.tag}: ${(n.text || '').slice(0, 50)} | children: ${n.children.length}`));
  
  console.log('\nFirst 20 flat nodes:');
  flat.slice(0, 20).forEach(n => console.log(`  ${'  '.repeat(n.depth)}${n.tag}: ${n.text} | ${n.selector}`));
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await engine.close().catch(() => {});
}