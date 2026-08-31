import { PipelineOrchestrator } from './packages/orchestrator/src/index';
import { createStore } from './packages/infra-store/src/index';
import { createEngine } from './packages/engine-mcp/src/index';

async function main() {
  const store = createStore(':memory:');
  const logger = {
    info: (scope: string, msg: string) => console.log(`[INFO][${scope}] ${msg}`),
    warn: (scope: string, msg: string) => console.warn(`[WARN][${scope}] ${msg}`),
    error: (scope: string, msg: string) => console.error(`[ERROR][${scope}] ${msg}`),
  };
  const orchestrator = new PipelineOrchestrator({
    store,
    logger,
    engineFactory: (cfg) => createEngine({ ...cfg, headless: true }),
  });

  console.log('--- Step 1: Run Stage Explore on https://demo.yunzong.cn/#/dashboard/index ---');
  const exploreRes = await orchestrator.runStage('explore', {
    systemUrl: 'https://demo.yunzong.cn/#/dashboard/index',
    systemId: 'demo_yunzong',
    scope: 'all',
  });
  console.log('Explore res success:', !!exploreRes);
  console.log('Explore modules count:', exploreRes.modules?.length);
  console.log('Explore featurePaths count:', Object.keys(exploreRes.featurePaths || {}).length);
  console.log('Sample featurePaths:', exploreRes.featurePaths);

  console.log('--- Step 2: Run Stage Feature ---');
  const featureRes = await orchestrator.runStage('feature', {
    systemId: 'demo_yunzong',
    scope: 'all',
    modules: exploreRes.modules,
    exploredElements: exploreRes.exploredElements,
    featurePaths: exploreRes.featurePaths,
  });
  console.log('Feature res table groups count:', featureRes.table?.length);
  console.log('Feature paths count:', Object.keys(featureRes.featurePaths || {}).length);
  console.log('Feature profiles count:', featureRes.featureProfiles?.length);
  console.log('Feature evidence count:', Object.keys(featureRes.featureEvidence || {}).length);

  console.log('--- Step 3: Run Stage Case ---');
  const caseRes = await orchestrator.runStage('case', {
    systemId: 'demo_yunzong',
    scope: 'all',
    featureTable: featureRes.table,
    featurePaths: featureRes.featurePaths,
    featureProfiles: featureRes.featureProfiles,
    featureEvidence: featureRes.featureEvidence,
    metaConfig: { precondition: '' },
  });
  console.log('Case groups count:', caseRes.caseGroups?.length);
  console.log('Feature results summary:');
  for (const r of caseRes.featureResults || []) {
    console.log(`- ${r.featureId} (${r.status}): ${r.reasons?.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Test failed with error:', err);
});
