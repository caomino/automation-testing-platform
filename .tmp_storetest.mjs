const base = 'http://localhost:3001';
async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
const out = {};
out.health = (await call('GET', '/health')).json;
out.bootstrap = (await call('GET', '/api/store/bootstrap')).json;
const created = await call('POST', '/api/store/projects', { name: 'integration-test' });
out.createProject = created;
const pid = created.json?.data?.id;
out.listProjects = (await call('GET', '/api/store/projects')).json;
const sid = 'sys_test_1';
out.addSystem = (await call('POST', `/api/store/projects/${pid}/systems`, { name: 'subsystem', url: 'https://example.com', type: 'standalone' })).json;
out.saveModuleTree = (await call('PUT', `/api/store/projects/${pid}/module-tree`, { systemId: sid, tree: [{ id: 'm1', label: 'mod1' }] })).json;
out.getModuleTree = (await call('GET', `/api/store/projects/${pid}/module-tree?systemId=${sid}`)).json;
out.saveMeta = (await call('PUT', `/api/store/projects/${pid}/meta-config`, { systemId: sid, meta: { precondition: 'ready' } })).json;
out.getMeta = (await call('GET', `/api/store/projects/${pid}/meta-config?systemId=${sid}`)).json;
out.saveFeature = (await call('PUT', `/api/store/projects/${pid}/feature-table`, { systemId: sid, table: [['1','f','3.1','s','main','sub','fn','pt','ID1']] })).json;
out.getFeature = (await call('GET', `/api/store/projects/${pid}/feature-table?systemId=${sid}`)).json;
out.knowledgePost = (await call('POST', '/api/store/knowledge', { scope: 'project', projectId: pid, content: 'note' })).json;
out.knowledgeList = (await call('GET', '/api/store/knowledge')).json;
out.recStartNoBrowser = (await call('POST', '/api/store/explore/start-recording', { systemId: sid, url: 'https://example.com' }));
console.log(JSON.stringify(out, null, 2));
