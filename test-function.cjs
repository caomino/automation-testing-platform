// Test the Function constructor
const DOM_WALK = `
(function walk(root) {
  function toNode(el) {
    return { tag: el.tagName, text: (el.textContent || '').trim().slice(0, 200), children: [] };
  }
  const roots = root ? [root] : [document.body];
  return roots.map(toNode);
})
`;

const f = new Function('return ' + DOM_WALK)();
console.log('typeof f:', typeof f);
console.log('f:', f);

if (typeof f === 'function') {
  // Test in Node.js context (no document)
  try {
    console.log('f(null):', f(null));
  } catch (e) {
    console.log('Error calling f:', e.message);
  }
}