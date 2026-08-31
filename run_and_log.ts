import { PipelineOrchestrator } from './packages/orchestrator/src/index';
import { createStore } from './packages/infra-store/src/index';
import { createEngine } from './packages/engine-mcp/src/index';
import * as fs from 'fs';

async function main() {
  const store = createStore(':memory:');
  const log = (msg: string) => {
    console.log(msg);
    fs.appendFileSync('/tmp/live_test.log', msg + '\n');
  };
  const logger = {
    info: (scope: string, msg: string) => log(`[INFO][${scope}] ${msg}`),
    warn: (scope: string, msg: string) => log(`[WARN][${scope}] ${msg}`),
    error: (scope: string, msg: string) => log(`[ERROR][${scope}] ${msg}`),
  };
  const orchestrator = new PipelineOrchestrator({
    store,
    logger,
    engineFactory: (cfg) => createEngine({ ...cfg, headless: true }),
  });

  const sessionHandle = {
    systemId: 'demo_yunzong',
    cookies: [],
    headers: {},
    tokens: {},
    expiresAt: Date.now() + 3600000,
  };

  log('--- Step 1: Run Stage Explore on https://demo.yunzong.cn/#/dashboard/index ---');
  const exploreRes = await orchestrator.runStage('explore', {
    systemUrl: 'https://demo.yunzong.cn/#/dashboard/index',
    systemId: 'demo_yunzong',
    subsystemId: 'demo_yunzong',
    sessionHandle,
    scope: 'all',
  });
  log(`Explore modules count: ${exploreRes.moduleTree?.length}`);
  log(`Explore exploredElements count: ${(exploreRes as any).exploredElements?.length}`);

  log('--- Step 2: Run Stage Feature ---');
  const featureRes = await orchestrator.runStage('feature', {
    systemId: 'demo_yunzong',
    scope: 'all',
    sessionHandle,
    moduleTree: exploreRes.moduleTree,
    exploredElements: (exploreRes as any).exploredElements,
    featurePaths: (exploreRes as any).featurePaths,
  });
  log(`Feature groups: ${featureRes.table?.length}, featureProfiles: ${featureRes.featureProfiles?.length}, evidence: ${Object.keys(featureRes.featureEvidence || {}).length}`);

  log('--- Step 3: Run Stage Case ---');
  const caseRes = await orchestrator.runStage('case', {
    systemId: 'demo_yunzong',
    systemUrl: 'https://demo.yunzong.cn/#/dashboard/index',
    sessionHandle,
    scope: 'all',
    featureTable: featureRes.table,
    featurePaths: featureRes.featurePaths,
    featureProfiles: featureRes.featureProfiles,
    featureEvidence: featureRes.featureEvidence,
    metaConfig: { precondition: '' },
  });
  log(`Case groups: ${caseRes.caseGroups?.length}`);
  for (const r of caseRes.featureResults || []) {
    log(`Result: ${r.featureId} [${r.status}] -> ${(r.reasons || []).join('; ')}`);
  }
  log('--- Pipeline Run Finished Successfully ---');
}

main().catch((err) => {
  fs.appendFileSync('/tmp/live_test.log', `Error: ${err.stack || err}\n`);
  console.error(err);
});
