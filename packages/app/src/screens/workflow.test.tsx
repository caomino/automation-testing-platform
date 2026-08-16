import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppProvider, useApp, initialState, loginModeLabel, loginStatusLabel, systemTypeLabel } from '../context';
import { Workbench } from '../screens/Workbench';
import { Explore } from '../screens/Explore';
import { Feature } from '../screens/Feature';
import { Case } from '../screens/Case';
import { Execute } from '../screens/Execute';
import { Defect } from '../screens/Defect';
import { Logs } from '../screens/Logs';
import { AIConfig } from '../screens/AIConfig';
import { ProjectMgmt } from '../screens/ProjectMgmt';
import { Knowledge } from '../screens/Knowledge';
import type { AppState } from '../context';

vi.mock('../context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../context')>();
  return {
    ...actual,
    useApp: vi.fn(),
  };
});

const mockUseApp = vi.mocked(useApp);

const createMockState = (overrides: Partial<AppState> = {}) => {
  const baseState = {
    ...initialState,
    project: { id: 'p1', name: 'Test Project', type: 'standalone' as const, description: '测试项目', systemCount: 2, createdAt: '2024-01-01', lastActive: '今天', status: '活跃' as const },
    system: { id: 's1', name: 'Test System', type: 'standalone' as const, url: 'http://test.com', captured: true, parent: 'Test Project', loginMode: 'no-login' as const, loginStatus: 'logged_in' as const },
    projects: [{ id: 'p1', name: 'Test Project', type: 'standalone' as const, description: '', systemCount: 2, createdAt: '2024-01-01', lastActive: '今天', status: '活跃' as const }],
    systems: [
      { id: 's1', name: 'Test System', type: 'standalone' as const, url: 'http://test.com', captured: true, parent: 'Test Project', loginMode: 'no-login' as const, loginStatus: 'logged_in' as const },
      { id: 's2', name: 'Sub System', type: 'subsystem' as const, url: 'http://sub.test.com', captured: true, parent: 'Test System', loginMode: 'credential' as const, loginStatus: 'logged_out' as const, parentPortalId: 's1', parentPortalPath: { name: 'Test System', url: 'http://test.com' } },
    ],
    featureRows: [],
    featureConfirmed: false,
    caseRows: [],
    metaHeader: { system: 'Test System', testPointId: 'TP-001', testPoint: '登录功能', testers: '张三', clientStaff: '李四', times: '2024-01-01', rules: '通过/失败' },
    execMatrix: [],
    execModules: [],
    execBrowsers: ['Win11·Chrome', 'Win11·Edge', 'macOS·Safari'],
    execCheckedModules: [],
    execIsolationPassed: false,
    defectRows: [],
    defectFilter: '全部模块',
    moduleTree: [],
    pendingTree: [],
    selectedModuleId: null,
    treeChecked: [],
    aiConfigs: [],
    aiCurrentDefault: '',
    logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
    logFiles: [],
    knowledge: [],
    activities: [],
    pipelineLoading: false,
    pipelineError: null,
    pipelineStage: null,
    caseSelectedModules: [],
    caseAiOn: false,
  } as any;

  return { ...baseState, ...overrides };
};

const setupDefaultMock = (overrides: Partial<AppState> = {}) => {
  const mockState = createMockState(overrides);
  const toastSpy = vi.fn();
  const mockActions = {
    ...mockState,
    setActiveScreen: vi.fn(),
    setSystem: vi.fn(),
    setLoginStatus: vi.fn(),
    toast: toastSpy,
    addActivity: vi.fn(),
    runPipelineLogin: vi.fn().mockResolvedValue({ loginStatus: 'ok' }),
    runPipelineExplore: vi.fn().mockResolvedValue({ moduleTree: [] }),
    runPipelineFeature: vi.fn().mockResolvedValue({ featureTable: [] }),
    runPipelineCase: vi.fn().mockResolvedValue({ caseWorkbook: [] }),
    runPipelineExecute: vi.fn().mockResolvedValue({ executionReport: [] }),
    runPipelineDefect: vi.fn().mockResolvedValue({ defectTable: [] }),
    featureAddRow: vi.fn(),
    featureAddModule: vi.fn(),
    featureUpdateRow: vi.fn(),
    featureRemoveRow: vi.fn(),
    featureConfirm: vi.fn(),
    featureUnconfirm: vi.fn(),
    featureToggleReview: vi.fn(),
    featureConfirmAll: vi.fn(),
    featureUnconfirmAll: vi.fn(),
    saveFeatureTable: vi.fn(),
    reloadFeatureTable: vi.fn(async () => { toastSpy('暂无数据可加载'); }),
    loadFeatureTemplate: vi.fn(() => { toastSpy('已加载固定模板'); }),
    caseAddRow: vi.fn(),
    caseRemoveRow: vi.fn(),
    caseUpdateRow: vi.fn(),
    caseUpdateMeta: vi.fn(),
    caseSetSelection: vi.fn(),
    caseToggleAi: vi.fn(),
    caseRegenerate: vi.fn(),
    execToggleModule: vi.fn(),
    execToggleAll: vi.fn(),
    execRun: vi.fn(),
    execSetCell: vi.fn(),
    execVerifyIsolation: vi.fn(),
    defectAdd: vi.fn(),
    defectUpdate: vi.fn(),
    defectRemove: vi.fn(),
    defectSetFilter: vi.fn(),
    exploreSetSelected: vi.fn(),
    exploreToggleChecked: vi.fn(),
    exploreAddModule: vi.fn(),
    exploreUpdateModule: vi.fn(),
    exploreRemoveModule: vi.fn(),
    exploreAddPending: vi.fn(),
    exploreRemovePending: vi.fn(),
    exploreUpdatePending: vi.fn(),
    explorePromoteToTree: vi.fn(),
    explorePromoteAll: vi.fn(),
    aiAdd: vi.fn(),
    aiUpdate: vi.fn(),
    aiRemove: vi.fn(),
    aiToggleEnabled: vi.fn(),
    aiSetDefault: vi.fn(),
    logUpdatePolicy: vi.fn(),
    logCleanupExpired: vi.fn(),
    logClearAll: vi.fn(),
    logRemoveFile: vi.fn(),
    knowledgeUpdate: vi.fn(),
    setProject: vi.fn(),
    addProject: vi.fn(),
    updateProject: vi.fn(),
    removeProject: vi.fn(),
    addSystem: vi.fn(),
    updateSystem: vi.fn(),
    removeSystem: vi.fn(),
    systemTypeLabel,
    loginModeLabel,
    loginStatusLabel,
  };
  mockUseApp.mockReturnValue(mockActions as any);
  return mockActions;
};

beforeEach(() => {
  vi.clearAllMocks();
  setupDefaultMock();
});

// ===== Workbench Tests =====
describe('Workbench 工作台', () => {
  it('已登录状态应显示 ✓ 已登录', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_in' },
    });
    render(<Workbench />);
    expect(screen.getByText('✓ 已登录')).toBeInTheDocument();
  });

  it('未登录状态应显示 ○ 未登录', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_out' },
    });
    render(<Workbench />);
    expect(screen.getByText('○ 未登录')).toBeInTheDocument();
  });

  it('未登录时流水线按钮应禁用', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_out' },
    });
    render(<Workbench />);
    expect(screen.getByText('🔐 登录系统')).toBeInTheDocument();
    expect(screen.getByText('🔍 探索')).toBeDisabled();
  });

  it('点击登录按钮应打开登录弹窗', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_out', loginMode: 'credential' },
    });
    render(<Workbench />);
    fireEvent.click(screen.getByText('🔐 登录系统'));
    expect(screen.getByText(/启动登录/)).toBeInTheDocument();
  });

  it('切换系统菜单应可展开并选择', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      systems: createMockState().systems,
      system: createMockState().system,
    });
    render(<Workbench />);
    fireEvent.click(screen.getByText('🔀 切换系统 ▾'));
    expect(screen.getByText(/Sub System/)).toBeInTheDocument();
  });

  it('点击探索按钮应调用 runPipelineExplore', async () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_in' },
      moduleTree: [{ id: 'm1', name: 'Test Module', status: '已覆盖' }],
    });
    render(<Workbench />);
    await fireEvent.click(screen.getByText('🔍 探索'));
    expect(mock.runPipelineExplore).toHaveBeenCalled();
  });

  it('点击功能点按钮应调用 runPipelineFeature', async () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_in' },
      moduleTree: [{ id: 'm1', name: 'Test Module', status: '已覆盖' }],
    });
    render(<Workbench />);
    await fireEvent.click(screen.getByText('📋 功能点'));
    expect(mock.runPipelineFeature).toHaveBeenCalled();
  });

  it('点击用例按钮应调用 runPipelineCase', async () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_in' },
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F', testPoint: 'TP', testPointId: 'TP-1' }],
    });
    render(<Workbench />);
    await fireEvent.click(screen.getByText('🧪 用例'));
    expect(mock.runPipelineCase).toHaveBeenCalled();
  });

  it('点击执行按钮应调用 runPipelineExecute', async () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_in' },
      caseRows: [{ caseNo: 'C1', content: 'Test', step: '1', operation: 'Click', expected: 'OK', firstResult: '\\', regressionResult: '\\', conclusion: '\\' }],
    });
    render(<Workbench />);
    await fireEvent.click(screen.getByText('▶ 执行'));
    expect(mock.runPipelineExecute).toHaveBeenCalled();
  });

  it('点击缺陷按钮应调用 runPipelineDefect', async () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_in' },
      execMatrix: [{ caseNo: 'C1', steps: 5, cells: [{ browser: 'Chrome', status: 'pass' }] }],
    });
    render(<Workbench />);
    await fireEvent.click(screen.getByText('🐛 缺陷'));
    expect(mock.runPipelineDefect).toHaveBeenCalled();
  });

  it('活动记录应正确显示', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      activities: [{ id: 'a1', time: '10:00', text: '登录成功' }],
    });
    render(<Workbench />);
    expect(screen.getByText('登录成功')).toBeInTheDocument();
  });

  it('pipelineLoading 时按钮应禁用', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, loginStatus: 'logged_in' },
      pipelineLoading: true,
    });
    render(<Workbench />);
    expect(screen.getByText('🔍 探索')).toBeDisabled();
  });

  it('子系统类型应显示父门户信息', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, type: 'subsystem', parent: 'Parent System', loginStatus: 'logged_in' },
    });
    render(<Workbench />);
    expect(screen.getByText(/Parent System/)).toBeInTheDocument();
  });
});

// ===== Explore Tests =====
describe('Explore 系统探索', () => {
  it('应正确渲染模块树', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [
        { id: 'm1', name: 'Module 1', status: '已覆盖' as const },
        { id: 'm2', name: 'Module 2', status: '未探索' as const },
      ],
    });
    render(<Explore />);
    expect(screen.getByText(/Module 1/)).toBeInTheDocument();
    expect(screen.getByText(/Module 2/)).toBeInTheDocument();
  });

  it('空模块树不崩溃', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [],
    });
    render(<Explore />);
    expect(screen.getAllByText(/系统探索/).length).toBeGreaterThan(0);
  });

  it('点击新增模块应打开Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [],
    });
    render(<Explore />);
    fireEvent.click(screen.getByRole('button', { name: '+ 新增模块' }));
    expect(screen.getByRole('heading', { name: '新增模块' })).toBeInTheDocument();
  });

  it('提交新模块应调用 exploreAddModule', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [],
      selectedModuleId: 'm1',
    });
    render(<Explore />);
    fireEvent.click(screen.getByRole('button', { name: '+ 新增模块' }));
    fireEvent.change(document.querySelector('.modal .text-input')!, { target: { value: 'New Module' } });
    fireEvent.click(screen.getByRole('button', { name: '确认添加' }));
    expect(mock.exploreAddModule).toHaveBeenCalledWith('m1', expect.objectContaining({ name: 'New Module' }));
  });

  it('新增模块名称为空时应提示', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [],
      selectedModuleId: null,
    });
    render(<Explore />);
    fireEvent.click(screen.getByText('+ 新增模块'));
    fireEvent.click(screen.getByText('确认添加'));
    expect(mock.toast).toHaveBeenCalledWith('请输入模块名称');
  });

  it('删除模块应弹出确认对话框', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [{ id: 'm1', name: 'Module 1' }],
      selectedModuleId: 'm1',
    });
    render(<Explore />);
    fireEvent.click(screen.getByText('删除选中'));
    expect(screen.getByText(/确定要删除选中的模块/)).toBeInTheDocument();
  });

  it('人工补充按钮应打开Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [],
    });
    render(<Explore />);
    fireEvent.click(screen.getByRole('button', { name: '👆 人工补充（自动开浏览器）' }));
    expect(screen.getByRole('heading', { name: /人工补充/ })).toBeInTheDocument();
  });

  it('导出模块树应触发下载', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [{ id: 'm1', name: 'Module 1' }],
    });
    const mockBlob = vi.fn();
    const mockCreateObjectURL = vi.fn(() => 'blob:mock');
    const mockRevokeObjectURL = vi.fn();
    vi.stubGlobal('Blob', mockBlob);
    vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

    render(<Explore />);
    fireEvent.click(screen.getByText('导出模块树'));
    expect(mockBlob).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('覆盖率统计应正确显示', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [
        { id: 'm1', name: 'Module 1', status: '已覆盖' as const },
        { id: 'm2', name: 'Module 2', status: '未探索' as const },
      ],
    });
    render(<Explore />);
    expect(screen.getByText('1/2 模块')).toBeInTheDocument();
  });

  it('待入树列表显示正确', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      system: { ...createMockState().system, url: 'http://test.com/explore' },
      moduleTree: [],
      pendingTree: [{ seq: 1, path: '/check/search', module: 'Search', confidence: '0.95', status: '待入树' }],
    });
    render(<Explore />);
    expect(screen.getAllByText(/\/check\/search/).length).toBeGreaterThan(0);
  });
});

// ===== Feature Tests =====
describe('Feature 功能点审核', () => {
  it('应正确渲染功能点表格', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [
        { seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: '功能点1', testPoint: 'TP1', testPointId: 'TP-1' },
      ],
    });
    render(<Feature />);
    expect(screen.getByText('功能点1')).toBeInTheDocument();
  });

  it('点击新增行应调用 featureAddRow', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F1', testPoint: 'TP1', testPointId: 'TP-1' }],
    });
    render(<Feature />);
    fireEvent.click(screen.getByText('+ 新增行'));
    expect(mock.featureAddRow).toHaveBeenCalled();
  });

  it('点击删除行应弹出确认对话框', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F1', testPoint: 'TP1', testPointId: 'TP-1' }],
    });
    render(<Feature />);
    fireEvent.click(screen.getAllByText('×')[0]);
    expect(screen.getByText(/确定要删除此行/)).toBeInTheDocument();
  });

  it('点击单元格应进入编辑模式', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: '可编辑内容', testPoint: 'TP1', testPointId: 'TP-1' }],
    });
    render(<Feature />);
    fireEvent.click(screen.getByText('可编辑内容'));
    expect(screen.getByDisplayValue('可编辑内容')).toBeInTheDocument();
  });

  it('复制到Excel应生成剪贴板文本', async () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F1', testPoint: 'TP1', testPointId: 'TP-1' }],
    });
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: mockWriteText } });

    render(<Feature />);
    fireEvent.click(screen.getByText('📋 复制到 Excel'));
    await waitFor(() => {
      expect(mock.toast).toHaveBeenCalledWith('已复制到剪贴板');
    });

    vi.unstubAllGlobals();
  });

  it('导出Excel应触发下载', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F1', testPoint: 'TP1', testPointId: 'TP-1' }],
    });
    const mockBlob = vi.fn();
    vi.stubGlobal('Blob', mockBlob);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    render(<Feature />);
    fireEvent.click(screen.getByText('导出 Excel'));
    expect(mockBlob).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('整体确认应弹出确认对话框', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F1', testPoint: 'TP1', testPointId: 'TP-1' }],
      featureConfirmed: false,
    });
    render(<Feature />);
    fireEvent.click(screen.getByText('✓ 整体确认'));
    expect(screen.getByText(/确认后/)).toBeInTheDocument();
  });

  it('已确认状态可取消确认', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F1', testPoint: 'TP1', testPointId: 'TP-1' }],
      featureConfirmed: true,
    });
    render(<Feature />);
    fireEvent.click(screen.getByText('✓ 已确认（点击取消）'));
    expect(mock.featureUnconfirm).toHaveBeenCalled();
  });

  it('加载固定模板应提示', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, featureRows: [] });
    render(<Feature />);
    fireEvent.click(screen.getByText('加载固定模板'));
    expect(mock.toast).toHaveBeenCalledWith('已加载固定模板');
  });

  it('加载本轮版本在空数据时应提示', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, featureRows: [] });
    render(<Feature />);
    fireEvent.click(screen.getByText('加载本轮版本'));
    expect(mock.toast).toHaveBeenCalledWith('暂无数据可加载');
  });

  it('needs_review 标记应可切换', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      featureRows: [{ seq: 'F1', type: '功能', chapter: 'C1', system: 'S', mainModule: 'M', subModule: 'SM', feature: 'F1', testPoint: 'TP1', testPointId: 'TP-1', needsReview: true }],
    });
    render(<Feature />);
    fireEvent.click(screen.getByText('needs_review'));
    expect(mock.featureToggleReview).toHaveBeenCalledWith(0);
  });
});

// ===== Case Tests =====
describe('Case 测试用例', () => {
  it('应正确渲染用例表格', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      caseRows: [
        { caseNo: 'C001', content: '登录测试', step: '1', operation: '点击登录', expected: '登录成功', firstResult: '\\', regressionResult: '\\', conclusion: '\\' },
      ],
      execModules: [{ name: '模块A', cases: 10, pending: false }],
    });
    render(<Case />);
    expect(screen.getByText('C001')).toBeInTheDocument();
  });

  it('点击单元格应进入编辑模式', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      caseRows: [
        { caseNo: 'C001', content: '可编辑内容', step: '1', operation: '点击', expected: 'OK', firstResult: '\\', regressionResult: '\\', conclusion: '\\' },
      ],
      execModules: [],
    });
    render(<Case />);
    fireEvent.click(screen.getByText('可编辑内容'));
    expect(screen.getByDisplayValue('可编辑内容')).toBeInTheDocument();
  });

  it('点击"+"应插入新行', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      caseRows: [
        { caseNo: 'C001', content: 'Test', step: '1', operation: 'Click', expected: 'OK', firstResult: '\\', regressionResult: '\\', conclusion: '\\' },
      ],
      execModules: [],
    });
    render(<Case />);
    fireEvent.click(screen.getAllByText('+')[0]);
    expect(mock.caseAddRow).toHaveBeenCalledWith(0);
  });

  it('点击"×"应弹出删除确认', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      caseRows: [
        { caseNo: 'C001', content: 'Test', step: '1', operation: 'Click', expected: 'OK', firstResult: '\\', regressionResult: '\\', conclusion: '\\' },
      ],
      execModules: [],
    });
    render(<Case />);
    fireEvent.click(screen.getAllByText('×')[0]);
    expect(screen.getByText(/确定要删除此条用例/)).toBeInTheDocument();
  });

  it('配置Modal应可打开', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, caseRows: [], execModules: [] });
    render(<Case />);
    fireEvent.click(screen.getByText('⚙ 配置'));
    expect(screen.getByText(/用例配置/)).toBeInTheDocument();
  });

  it('保存配置应调用 caseUpdateMeta', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, caseRows: [], execModules: [] });
    render(<Case />);
    fireEvent.click(screen.getByText('⚙ 配置'));
    fireEvent.change(document.querySelector('.modal .text-input')!, { target: { value: 'New System' } });
    fireEvent.click(screen.getByRole('button', { name: '应用配置到 Excel' }));
    expect(mock.caseUpdateMeta).toHaveBeenCalled();
  });

  it('AI 辅助开关应调用 caseToggleAi', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, caseRows: [], execModules: [], caseAiOn: false });
    render(<Case />);
    const toggle = screen.getByText('AI 辅助').closest('.toggle');
    if (toggle) fireEvent.click(toggle);
    expect(mock.caseToggleAi).toHaveBeenCalled();
  });

  it('生成选中应调用 caseRegenerate', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, caseRows: [], execModules: [] });
    render(<Case />);
    fireEvent.click(screen.getByText('生成选中'));
    expect(mock.caseRegenerate).toHaveBeenCalled();
  });

  it('全部生成应调用 caseRegenerate', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, caseRows: [], execModules: [] });
    render(<Case />);
    fireEvent.click(screen.getByText('全部生成'));
    expect(mock.caseRegenerate).toHaveBeenCalled();
  });

  it('选择模块Modal应可打开', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, caseRows: [], execModules: [{ name: '模块A', cases: 5, pending: false }] });
    render(<Case />);
    fireEvent.click(screen.getByText(/选择模块/));
    expect(screen.getByText(/确认选择/)).toBeInTheDocument();
  });

  it('导出CSV应触发下载', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      caseRows: [{ caseNo: 'C1', content: 'Test', step: '1', operation: 'Op', expected: 'Exp', firstResult: '\\', regressionResult: '\\', conclusion: '\\' }],
      execModules: [],
    });
    const mockBlob = vi.fn();
    vi.stubGlobal('Blob', mockBlob);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    render(<Case />);
    fireEvent.click(screen.getByText('导出 CSV'));
    expect(mockBlob).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('空用例列表不崩溃', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, caseRows: [], execModules: [] });
    render(<Case />);
    expect(screen.getAllByText(/用例/).length).toBeGreaterThan(0);
  });
});

// ===== Execute Tests =====
describe('Execute 执行', () => {
  it('应正确渲染执行矩阵', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execMatrix: [{ caseNo: 'C1', steps: 5, cells: [{ browser: 'Chrome', status: 'pass' }] }],
      execBrowsers: ['Chrome'],
      execModules: [],
      execCheckedModules: [],
    });
    render(<Execute />);
    expect(screen.getByText('C1')).toBeInTheDocument();
  });

  it('模块列表应正确渲染', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execModules: [
        { name: 'Module A', cases: 10, pending: false },
        { name: 'Module B', cases: 5, pending: false },
      ],
      execBrowsers: ['Chrome'],
      execMatrix: [],
      execCheckedModules: ['Module A'],
    });
    render(<Execute />);
    expect(screen.getByText(/Module A/)).toBeInTheDocument();
    expect(screen.getByText(/Module B/)).toBeInTheDocument();
  });

  it('全选按钮应调用 execToggleAll', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execModules: [{ name: 'Module A', cases: 10, pending: false }],
      execBrowsers: ['Chrome'],
      execMatrix: [],
      execCheckedModules: [],
    });
    render(<Execute />);
    fireEvent.click(screen.getByText('☐ 全选'));
    expect(mock.execToggleAll).toHaveBeenCalledWith(true);
  });

  it('无选中时执行按钮应禁用', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execModules: [{ name: 'Module A', cases: 10, pending: false }],
      execBrowsers: ['Chrome'],
      execMatrix: [],
      execCheckedModules: [],
    });
    render(<Execute />);
    expect(screen.getByText(/执行选中/)).toBeDisabled();
  });

  it('有选中时执行按钮应可用并调用 execRun', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execModules: [{ name: 'Module A', cases: 10, pending: false }],
      execBrowsers: ['Chrome'],
      execMatrix: [],
      execCheckedModules: ['Module A'],
    });
    render(<Execute />);
    fireEvent.click(screen.getByText(/执行选中/));
    expect(mock.execRun).toHaveBeenCalledWith('selected');
  });

  it('执行全部应调用 execRun("all")', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execModules: [{ name: 'Module A', cases: 10, pending: false }],
      execBrowsers: ['Chrome'],
      execMatrix: [],
      execCheckedModules: [],
    });
    render(<Execute />);
    fireEvent.click(screen.getByText('▶ 执行全部'));
    expect(mock.execRun).toHaveBeenCalledWith('all');
  });

  it('点击矩阵单元格应显示详情Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execMatrix: [{ caseNo: 'C1', steps: 5, cells: [{ browser: 'Chrome', status: 'pass' }] }],
      execBrowsers: ['Chrome'],
      execModules: [],
      execCheckedModules: [],
    });
    render(<Execute />);
    fireEvent.click(screen.getByText('C1'));
    expect(screen.getByText(/用例详情/)).toBeInTheDocument();
  });

  it('数据隔离Verify应打开Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execModules: [],
      execBrowsers: ['Chrome'],
      execMatrix: [],
      execCheckedModules: [],
    });
    render(<Execute />);
    fireEvent.click(screen.getByRole('button', { name: '🛡 数据隔离 Verify' }));
    expect(screen.getByRole('heading', { name: /数据隔离 Verify/ })).toBeInTheDocument();
  });

  it('导出结果应触发下载', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      execMatrix: [{ caseNo: 'C1', steps: 5, cells: [{ browser: 'Chrome', status: 'pass' }] }],
      execBrowsers: ['Chrome'],
      execModules: [],
      execCheckedModules: [],
    });
    const mockBlob = vi.fn();
    vi.stubGlobal('Blob', mockBlob);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    render(<Execute />);
    fireEvent.click(screen.getByText('📥 导出结果'));
    expect(mockBlob).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

// ===== Defect Tests =====
describe('Defect 缺陷', () => {
  it('应正确渲染缺陷列表', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      defectRows: [{ seq: 1, description: 'Bug 1', level: '高', qualityAttribute: '功能正确性', environment: 'Win11·Chrome' }],
    });
    render(<Defect />);
    expect(screen.getByText('Bug 1')).toBeInTheDocument();
  });

  it('空缺陷列表不崩溃', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, defectRows: [] });
    render(<Defect />);
    expect(screen.getAllByText(/缺陷/).length).toBeGreaterThan(0);
  });

  it('点击新建缺陷应打开Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, defectRows: [] });
    render(<Defect />);
    fireEvent.click(screen.getByRole('button', { name: '+ 新建缺陷' }));
    expect(screen.getByRole('heading', { name: /新建缺陷/ })).toBeInTheDocument();
  });

  it('创建缺陷应调用 defectAdd', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, defectRows: [] });
    render(<Defect />);
    fireEvent.click(screen.getByRole('button', { name: '+ 新建缺陷' }));
    fireEvent.change(document.querySelector('.modal .text-area')!, { target: { value: '新缺陷描述' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(mock.defectAdd).toHaveBeenCalled();
  });

  it('筛选按钮应调用 defectSetFilter', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      defectRows: [{ seq: 1, description: 'Bug 1', level: '高', qualityAttribute: '功能正确性', environment: 'Win11·Chrome' }],
      execModules: [{ name: '模块A', cases: 5, pending: false }],
    });
    render(<Defect />);
    fireEvent.click(screen.getByText('模块A'));
    expect(mock.defectSetFilter).toHaveBeenCalledWith('模块A');
  });

  it('导出缺陷应触发下载', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      defectRows: [{ seq: 1, description: 'Bug 1', level: '高', qualityAttribute: '功能正确性', environment: 'Win11·Chrome' }],
    });
    const mockBlob = vi.fn();
    vi.stubGlobal('Blob', mockBlob);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    render(<Defect />);
    fireEvent.click(screen.getByText('📤 导出'));
    expect(mockBlob).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('高优先级标签应显示', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      defectRows: [{ seq: 1, description: 'Bug 1', level: '高', qualityAttribute: '功能正确性', environment: 'Win11·Chrome' }],
    });
    render(<Defect />);
    expect(screen.getByText('高')).toBeInTheDocument();
  });
});

// ===== ProjectMgmt Tests =====
describe('ProjectMgmt 项目管理', () => {
  it('应正确渲染项目列表', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      projects: [{ id: 'p1', name: 'Project 1', type: 'standalone' as const, description: 'desc', systemCount: 2, caseCount: 10, createdAt: '2024-01-01', lastActive: '今天', status: '活跃' as const }],
    });
    render(<ProjectMgmt />);
    expect(screen.getByText('Project 1')).toBeInTheDocument();
  });

  it('点击新建项目应打开Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock });
    render(<ProjectMgmt />);
    fireEvent.click(screen.getByRole('button', { name: '+ 新建项目' }));
    expect(screen.getByRole('heading', { name: /新建项目/ })).toBeInTheDocument();
  });

  it('点击行内「+ 系统」应打开新建系统Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock });
    render(<ProjectMgmt />);
    fireEvent.click(screen.getByRole('button', { name: '+ 系统' }));
    expect(screen.getByRole('heading', { name: /新建系统/ })).toBeInTheDocument();
  });

  it('选择子系统类型应显示父门户选项', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      systems: [
        { id: 'portal1', name: 'Portal System', type: 'portal' as const, url: 'http://portal.com', captured: true, parent: '', loginMode: 'no-login' as const, loginStatus: 'logged_in' as const },
      ],
    });
    render(<ProjectMgmt />);
    fireEvent.click(screen.getByRole('button', { name: '+ 系统' }));
    const selects = document.querySelectorAll('.modal select');
    fireEvent.change(selects[0], { target: { value: 'subsystem' } });
    expect(screen.getAllByText(/父门户系统/).length).toBeGreaterThan(0);
  });

  it('选择 credential 登录方式应显示账号密码字段', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock });
    render(<ProjectMgmt />);
    fireEvent.click(screen.getByRole('button', { name: '+ 系统' }));
    const selects = document.querySelectorAll('.modal select');
    fireEvent.change(selects[1], { target: { value: 'credential' } });
    expect(screen.getAllByText(/账号/).length).toBeGreaterThan(0);
  });

  it('展开项目后点击「进入」应调用 setSystem 和 setActiveScreen', async () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      systems: [{ id: 's1', name: 'System 1', type: 'standalone' as const, url: 'http://test.com', captured: true, parent: '', loginMode: 'no-login' as const, loginStatus: 'logged_in' as const, projectId: 'p1' }],
    });
    render(<ProjectMgmt />);
    fireEvent.click(screen.getByText('▶'));
    const enterBtn = await screen.findByRole('button', { name: '进入' });
    fireEvent.click(enterBtn);
    expect(mock.setSystem).toHaveBeenCalledWith('s1');
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s1');
  });

  it('删除项目应弹出确认对话框', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      projects: [{ id: 'p1', name: 'Project 1', type: 'standalone' as const, description: '', systemCount: 0, caseCount: 0, createdAt: '', lastActive: '', status: '活跃' as const }],
    });
    render(<ProjectMgmt />);
    fireEvent.click(screen.getAllByRole('button', { name: '删除' })[0]);
    expect(screen.getByText(/确定要删除此项目/)).toBeInTheDocument();
  });
});

// ===== AIConfig Tests =====
describe('AIConfig AI配置', () => {
  it('应正确渲染配置列表', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      aiConfigs: [
        { id: 'ai-1', enabled: true, name: 'GPT-4', vendor: 'OpenAI', baseUrl: 'https://api.openai.com', model: 'gpt-4', isDefault: true },
      ],
    });
    render(<AIConfig />);
    expect(screen.getAllByText('GPT-4').length).toBeGreaterThan(0);
  });

  it('点击添加配置应打开Modal', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, aiConfigs: [] });
    render(<AIConfig />);
    fireEvent.click(screen.getByText('+ 添加配置'));
    expect(screen.getByText(/添加 AI 配置/)).toBeInTheDocument();
  });

  it('启用/禁用应调用 aiToggleEnabled', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      aiConfigs: [{ id: 'ai-1', enabled: true, name: 'GPT-4', vendor: 'OpenAI', baseUrl: 'https://api.com', model: 'gpt-4', isDefault: false }],
    });
    render(<AIConfig />);
    fireEvent.click(screen.getByRole('button', { name: '✓' }));
    expect(mock.aiToggleEnabled).toHaveBeenCalledWith('ai-1');
  });

  it('设为默认应调用 aiSetDefault', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      aiConfigs: [{ id: 'ai-1', enabled: true, name: 'GPT-4', vendor: 'OpenAI', baseUrl: 'https://api.com', model: 'gpt-4', isDefault: false }],
    });
    render(<AIConfig />);
    fireEvent.click(screen.getByText('设为默认'));
    expect(mock.aiSetDefault).toHaveBeenCalledWith('ai-1');
  });

  it('删除配置应弹出确认', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      aiConfigs: [{ id: 'ai-1', enabled: true, name: 'GPT-4', vendor: 'OpenAI', baseUrl: 'https://api.com', model: 'gpt-4', isDefault: false }],
    });
    render(<AIConfig />);
    fireEvent.click(screen.getAllByText('删除')[0]);
    expect(screen.getByText(/确定要删除此 AI 配置/)).toBeInTheDocument();
  });

  it('空列表不崩溃', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, aiConfigs: [] });
    render(<AIConfig />);
    expect(screen.getByText(/AI 配置列表/)).toBeInTheDocument();
  });
});

// ===== Logs Tests =====
describe('Logs 日志管理', () => {
  it('应正确渲染日志页面', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
      logFiles: [],
    });
    render(<Logs />);
    expect(screen.getByText(/日志管理/)).toBeInTheDocument();
  });

  it('保留天数选择应更新', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
      logFiles: [],
    });
    render(<Logs />);
    fireEvent.click(screen.getByRole('button', { name: '7 天' }));
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));
    expect(mock.logUpdatePolicy).toHaveBeenCalledWith({ retentionDays: 7, maxFileSizeMB: 10, maxFiles: 30 });
  });

  it('保存策略应调用 logUpdatePolicy', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
      logFiles: [],
    });
    render(<Logs />);
    fireEvent.click(screen.getByText('保存策略'));
    expect(mock.logUpdatePolicy).toHaveBeenCalled();
  });

  it('清理过期应弹出确认', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
      logFiles: [{ subsystem: 'sys', task: 'task', filename: 'log.txt', size: '1KB', lastWrite: '2024-01-01' }],
    });
    render(<Logs />);
    fireEvent.click(screen.getByText('🧹 清理过期'));
    expect(screen.getByText(/确定要执行吗/)).toBeInTheDocument();
  });

  it('一键清空应弹出确认', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
      logFiles: [{ subsystem: 'sys', task: 'task', filename: 'log.txt', size: '1KB', lastWrite: '2024-01-01' }],
    });
    render(<Logs />);
    fireEvent.click(screen.getByText('💥 一键清空'));
    expect(screen.getByText(/此操作将删除所有日志/)).toBeInTheDocument();
  });

  it('日志文件列表应正确显示', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      logPolicy: { retentionDays: 30, maxFileSizeMB: 10, maxFiles: 30 },
      logFiles: [{ subsystem: 'sys1', task: 'task1', filename: 'test.log', size: '10KB', lastWrite: '2024-01-01' }],
    });
    render(<Logs />);
    expect(screen.getByText('test.log')).toBeInTheDocument();
  });
});

// ===== Knowledge Tests =====
describe('Knowledge 知识库', () => {
  it('应正确渲染知识列表', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      knowledge: [
        { id: 'k1', name: '通用规则', scope: 'global' as const, content: '通用提示词内容' },
        { id: 'k2', name: '系统规则', scope: 'system' as const, systemId: 's1', content: '系统提示词' },
      ],
    });
    render(<Knowledge />);
    expect(screen.getAllByText(/通用规则/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/系统规则/).length).toBeGreaterThan(0);
  });

  it('选择知识条目应切换内容', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      knowledge: [
        { id: 'k1', name: '规则1', scope: 'global' as const, content: '内容1' },
        { id: 'k2', name: '规则2', scope: 'system' as const, content: '内容2' },
      ],
    });
    render(<Knowledge />);
    fireEvent.click(screen.getByText(/规则2/));
    expect(screen.getByDisplayValue('内容2')).toBeInTheDocument();
  });

  it('保存应调用 knowledgeUpdate', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      knowledge: [{ id: 'k1', name: '规则1', scope: 'global' as const, content: '原始内容' }],
    });
    render(<Knowledge />);
    fireEvent.change(screen.getByDisplayValue('原始内容'), { target: { value: '修改后的内容' } });
    fireEvent.click(screen.getAllByText('保存')[0]);
    expect(mock.knowledgeUpdate).toHaveBeenCalled();
  });

  it('重置应恢复原始内容', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({
      ...mock,
      knowledge: [{ id: 'k1', name: '规则1', scope: 'global' as const, content: '原始内容' }],
    });
    render(<Knowledge />);
    fireEvent.change(screen.getByDisplayValue('原始内容'), { target: { value: '修改后' } });
    fireEvent.click(screen.getAllByText('重置')[0]);
    expect(mock.toast).toHaveBeenCalledWith('已重置');
  });

  it('空知识库不崩溃', () => {
    const mock = setupDefaultMock();
    mockUseApp.mockReturnValue({ ...mock, knowledge: [] });
    render(<Knowledge />);
    expect(screen.getAllByText(/知识库/).length).toBeGreaterThan(0);
  });
});