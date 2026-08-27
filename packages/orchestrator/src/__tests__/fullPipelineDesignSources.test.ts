import { describe, expect, it, vi } from 'vitest';

const stageFeatureRun = vi.hoisted(() => vi.fn());

vi.mock('@test-platform/stage-login', () => ({
  createLoginStage: () => ({ run: vi.fn().mockResolvedValue({ loginStatus: 'ok', sessionHandle: { sessionId: 'session', systemId: 'sys', loginStatus: 'ok', cookies: [], expiresAt: Date.now() + 60_000 } }) }),
  getTakeoverEngine: () => undefined,
}));
vi.mock('@test-platform/stage-explore', () => ({
  run: vi.fn().mockResolvedValue({ moduleTree: [], coverage: { visited: 0, total: 0, frontier: [] }, needsReview: [], checkpoint: { checkpointId: 'cp', visitedNodeIds: [], frontier: [], savedAt: 0 } }),
}));
vi.mock('@test-platform/stage-feature', () => ({
  run: stageFeatureRun.mockResolvedValue({ featureTable: [], featureIds: [], provenance: [], featureProfiles: [], featureEvidence: {} }),
}));
vi.mock('@test-platform/stage-case', () => ({
  run: vi.fn().mockResolvedValue({ caseWorkbook: [], caseRows: [], metaHeader: {}, qualityGateIssues: [], complexLogicDetected: false }),
}));
vi.mock('@test-platform/stage-execute', () => ({
  run: vi.fn().mockResolvedValue({ executionReport: [], dataSnapshotBefore: { id: 'before', data: {} }, dataSnapshotAfter: { id: 'after', data: {} }, isolationVerified: true }),
}));
vi.mock('@test-platform/stage-defect', () => ({ run: vi.fn().mockResolvedValue({ defectTable: [], screenshots: [] }) }));

import { PipelineOrchestrator } from '../index.js';

describe('full pipeline feature design sources', () => {
  it('透传 input.feature.designSources 给 feature stage 并持久化来源名称', async () => {
    const store = {
      createProject: vi.fn().mockResolvedValue({ id: 'project', name: 'pipeline', description: '', type: 'standalone', createdAt: 0 }),
      saveSession: vi.fn().mockResolvedValue(undefined),
      getFeatureArtifact: vi.fn().mockResolvedValue(null),
      saveFeatureArtifact: vi.fn().mockResolvedValue(undefined),
      saveCaseTable: vi.fn().mockResolvedValue(undefined),
      saveExecution: vi.fn().mockResolvedValue(undefined),
    };
    const engine = { launch: vi.fn(), navigate: vi.fn(), applySession: vi.fn() };
    const orchestrator = new PipelineOrchestrator({
      store: store as never,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
      engineFactory: () => engine as never,
    });
    const designSources = [{ kind: 'openapi' as const, name: 'patient-api.yaml', content: '{"openapi":"3.0.0","paths":{}}' }];

    await orchestrator.run({
      login: { systemId: 'sys', systemUrl: 'https://x.test', mode: 'no-login' },
      feature: { designSources },
    });

    expect(stageFeatureRun).toHaveBeenCalledWith(expect.objectContaining({ designSources }));
    expect(vi.mocked(store.saveFeatureArtifact).mock.calls[0][1].designSources).toEqual(['patient-api.yaml']);
  });
});
