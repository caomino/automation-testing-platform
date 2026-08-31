import { describe, it, expect } from 'vitest';
import {
  initialState,
  reducer,
} from '../context';
import type {
  AppState,
  ProjectInfo,
  SystemInfo,
  ModuleNodeView,
  FeatureRowView,
  CaseRowView,
  MetaHeader,
  ExecMatrixRow,
  ExecModuleState,
} from '../context';

// Helper to create a basic state
const createInitialState = (): AppState => {
  return { ...initialState };
};

describe('context.tsx - Reducer 逻辑', () => {
  it('should initialize with empty/default state', () => {
    const state = createInitialState();
    expect(state.projects).toEqual([]);
    expect(state.systems).toEqual([]);
    expect(state.featureRows).toEqual([]);
    expect(state.caseRows).toEqual([]);
  });

  it('SET_PROJECT: should set active project', () => {
    const project: ProjectInfo = { id: 'p1', name: 'Test Project', type: 'standalone', description: '', systemCount: 0, caseCount: 0, createdAt: '', lastActive: '', status: '活跃' };
    const state = { ...initialState, projects: [project] };
    const newState = reducer(state, { type: 'SET_PROJECT', id: 'p1' });
    expect(newState.project.id).toBe('p1');
    expect(newState.project.name).toBe('Test Project');
  });

  it('SET_SYSTEM: should set active system', () => {
    const state = createInitialState();
    const system: SystemInfo = { id: 's1', name: 'Test System', type: 'standalone', url: 'http://test.com', captured: true, parent: '', loginMode: 'no-login', loginStatus: 'logged_out' };
    const newState = reducer({ ...state, systems: [system] }, { type: 'SET_SYSTEM', id: 's1' });
    expect(newState.system.id).toBe('s1');
    expect(newState.system.name).toBe('Test System');
  });

  it('A→B→A 切换时立即清空系统专属功能点、证据和用例状态', () => {
    const project: ProjectInfo = { id: 'p1', name: 'Project', type: 'standalone', description: '', systemCount: 2, caseCount: 0, createdAt: '', lastActive: '', status: '活跃', activeSystemId: 'A' };
    const systemA: SystemInfo = { id: 'A', name: 'System A', type: 'standalone', url: '', captured: false, parent: '', projectId: 'p1', loginMode: 'no-login', loginStatus: 'logged_out' };
    const systemB: SystemInfo = { ...systemA, id: 'B', name: 'System B' };
    const populated: AppState = {
      ...initialState,
      project,
      projects: [project],
      system: systemA,
      systems: [systemA, systemB],
      featureRows: [{ seq: '1', type: '功能', chapter: '', system: 'A', mainModule: '', subModule: '', feature: '功能', testPoint: '新增', testPointId: 'A_01' }],
      featureConfirmed: true,
      featurePaths: { A_01: '/a' },
      featureProfiles: [{ featureId: 'A_01', testPoint: '新增', actionKind: 'create' }],
      featureEvidence: { A_01: { featureId: 'A_01', actionKind: 'create', states: [], fields: [], tables: [], actionEntries: [], containers: [], evidenceLevel: 'needs_review', coverageKeys: [], needsReview: true, reviewReason: '缺少证据', uncovered: [] } },
      featureProvenance: [{ provenanceId: 'a', featureRowIndex: 0, source: 'exploration', confirmed: true }],
      featureDesignSources: ['a.json'],
      caseRows: [{ caseNo: 'A_01_A01', content: '新增', step: 'Step_1', operation: '操作', expected: '预期', firstResult: '\\', regressionResult: '\\', conclusion: '\\' }],
      caseGroups: [{ groupId: 'a', caseNo: 'A_01_A01', content: '新增', moduleName: '', precondition: '', steps: [] }],
      caseQualityGateIssues: [{ caseRowId: 'a', type: '泛化', message: '旧问题', blocking: true }],
    };
    const onB = reducer(populated, { type: 'SET_SYSTEM', id: 'B' });
    const backOnA = reducer(onB, { type: 'SET_SYSTEM', id: 'A' });
    for (const state of [onB, backOnA]) {
      expect(state.featureRows).toEqual([]);
      expect(state.featureConfirmed).toBe(false);
      expect(state.featureProfiles).toEqual([]);
      expect(state.featureEvidence).toEqual({});
      expect(state.featureDesignSources).toEqual([]);
      expect(state.caseRows).toEqual([]);
      expect(state.caseGroups).toEqual([]);
      expect(state.caseQualityGateIssues).toEqual([]);
    }
  });

  it('ADD_PROJECT: should add a new project', () => {
    const state = createInitialState();
    const project: ProjectInfo = { id: 'p1', name: 'New Project', type: 'standalone', description: '', systemCount: 0, caseCount: 0, createdAt: '', lastActive: '', status: '活跃' };
    const newState = reducer(state, { type: 'ADD_PROJECT', project });
    expect(newState.projects).toHaveLength(1);
    expect(newState.projects[0].name).toBe('New Project');
  });

  it('UPDATE_PROJECT: should update an existing project', () => {
    const project: ProjectInfo = { id: 'p1', name: 'Old Name', type: 'standalone', description: '', systemCount: 0, caseCount: 0, createdAt: '', lastActive: '', status: '活跃' };
    const state = { ...initialState, projects: [project] };
    const newState = reducer(state, { type: 'UPDATE_PROJECT', id: 'p1', patch: { name: 'New Name' } });
    expect(newState.projects[0].name).toBe('New Name');
  });

  it('ADD_SYSTEM: should add a system', () => {
    const system: SystemInfo = { id: 's1', name: 'System', type: 'standalone', url: 'http://sys.com', captured: true, parent: 'Project', loginMode: 'no-login', loginStatus: 'logged_out' };
    const state = { ...initialState, systems: [] };
    const newState = reducer(state, { type: 'ADD_SYSTEM', system });
    expect(newState.systems).toHaveLength(1);
    expect(newState.systems[0].name).toBe('System');
  });

  it('SET_LOGIN_STATUS: should update login status', () => {
    const system: SystemInfo = { id: 's1', name: 'System', type: 'standalone', url: '', captured: false, parent: '', loginMode: 'no-login', loginStatus: 'logged_out' };
    const state = { ...initialState, systems: [system], system };
    const newState = reducer(state, { type: 'SET_LOGIN_STATUS', id: 's1', status: 'logged_in' });
    expect(newState.systems[0].loginStatus).toBe('logged_in');
    expect(newState.system.loginStatus).toBe('logged_in');
  });

  it('SET_SESSION_STATE: should save session state', () => {
    const system: SystemInfo = { id: 's1', name: 'System', type: 'standalone', url: '', captured: false, parent: '', loginMode: 'no-login', loginStatus: 'logged_in' };
    const state = { ...initialState, systems: [system], system };
    const sessionState = { cookies: ['cookie1'], headers: { 'X-Token': 'token' }, tokens: ['token1'], expiresAt: Date.now() + 3600000 };
    const newState = reducer(state, { type: 'SET_SESSION_STATE', id: 's1', sessionState });
    expect(newState.systems[0].sessionState).toEqual(sessionState);
    expect(newState.system.sessionState).toEqual(sessionState);
  });

  it('PIPELINE_SET_LOADING: should set loading state', () => {
    const state = createInitialState();
    const newState = reducer(state, { type: 'PIPELINE_SET_LOADING', loading: true, stage: 'login' });
    expect(newState.pipelineLoading).toBe(true);
    expect(newState.pipelineStage).toBe('login');
  });

  it('PIPELINE_SET_ERROR: should set error state', () => {
    const state = createInitialState();
    const newState = reducer(state, { type: 'PIPELINE_SET_ERROR', error: 'Test Error' });
    expect(newState.pipelineError).toBe('Test Error');
  });

  it('PIPELINE_UPDATE_MODULE_TREE: should update module tree', () => {
    const state = createInitialState();
    const nodes: ModuleNodeView[] = [{ id: 'm1', name: 'Module 1', status: '已覆盖' }];
    const newState = reducer(state, { type: 'PIPELINE_UPDATE_MODULE_TREE', nodes });
    expect(newState.moduleTree).toHaveLength(1);
    expect(newState.moduleTree[0].name).toBe('Module 1');
  });

  it('PIPELINE_UPDATE_FEATURE: should update feature rows', () => {
    const state = createInitialState();
    const rows: FeatureRowView[] = [{ seq: '1', type: 'F', chapter: 'C', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'Feat', testPoint: 'TP', testPointId: 'TP-1' }];
    const newState = reducer(state, { type: 'PIPELINE_UPDATE_FEATURE', rows });
    expect(newState.featureRows).toHaveLength(1);
    expect(newState.featureConfirmed).toBe(false);
  });

  it('FEATURE_CONFIRM: should confirm features', () => {
    const state = createInitialState();
    const newState = reducer(state, { type: 'FEATURE_CONFIRM' });
    expect(newState.featureConfirmed).toBe(true);
  });

  it('PIPELINE_UPDATE_CASE: should update case rows and meta', () => {
    const state = createInitialState();
    const rows: CaseRowView[] = [{ caseNo: 'C1', content: 'Content', step: 'Step', operation: 'Op', expected: 'Exp', firstResult: '', regressionResult: '', conclusion: '\\' }];
    const meta: MetaHeader = { ...initialState.metaHeader, system: 'S', testPointId: 'TP-1', testPoint: 'TP', testers: 'T', clientStaff: 'C' };
    const newState = reducer(state, { type: 'PIPELINE_UPDATE_CASE', rows, groups: [], meta });
    expect(newState.caseRows).toHaveLength(1);
    expect(newState.metaHeader.system).toBe('S');
  });

  it('PIPELINE_UPDATE_EXEC: should update exec matrix and modules', () => {
    const state = createInitialState();
    const matrix: ExecMatrixRow[] = [{ caseNo: 'C1', steps: 5, cells: [{ browser: 'Chrome', status: 'pass' }] }];
    const modules: ExecModuleState[] = [{ name: 'M', cases: 5, pass: 5 }];
    const newState = reducer(state, { type: 'PIPELINE_UPDATE_EXEC', matrix, modules });
    expect(newState.execMatrix).toHaveLength(1);
    expect(newState.execModules).toHaveLength(1);
    expect(newState.execModules[0].name).toBe('M');
  });

  it('ADD_ACTIVITY: should add an activity log', () => {
    const state = createInitialState();
    const item = { id: 'a1', time: '10:00', text: 'Test Activity' };
    const newState = reducer(state, { type: 'ADD_ACTIVITY', item });
    expect(newState.activities).toHaveLength(1);
    expect(newState.activities[0].text).toBe('Test Activity');
  });

  it('SET_SCREEN: should set active screen', () => {
    const state = createInitialState();
    const newState = reducer(state, { type: 'SET_SCREEN', screen: 's2' });
    expect(newState.activeScreen).toBe('s2');
  });
});
