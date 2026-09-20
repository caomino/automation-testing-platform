import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AppProvider, useApp, initialState, loginStatusLabel } from './context';
import { App } from './App';

vi.mock('./context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./context')>();
  return {
    ...actual,
    useApp: vi.fn(),
  };
});

const mockUseApp = vi.mocked(useApp);

const createMock = (overrides: any = {}) => {
  const base = {
    ...initialState,
    project: { id: 'p1', name: 'Test Project', type: 'standalone' as const, description: '', systemCount: 2, createdAt: '2024-01-01', lastActive: '今天', status: '活跃' as const },
    system: { id: 's1', name: 'Test System', type: 'standalone' as const, url: 'http://test.com', captured: true, parent: '', loginMode: 'no-login' as const, loginStatus: 'logged_in' as const },
    activeScreen: 's1',
    featureRows: [],
    caseRows: [],
    execMatrix: [],
    execModules: [],
    execBrowsers: ['Chrome'],
    execCheckedModules: [],
    defectRows: [],
    moduleTree: [],
    pendingTree: [],
    aiConfigs: [],
    logFiles: [],
    knowledge: [],
    activities: [],
    pipelineLoading: false,
  };
  return { ...base, ...overrides };
};

const setup = (overrides: any = {}) => {
  const state = createMock(overrides);
  const actions = {
    ...state,
    setActiveScreen: vi.fn(),
    setSystem: vi.fn(),
    setLoginStatus: vi.fn(),
    toast: vi.fn(),
    addActivity: vi.fn(),
    runPipelineLogin: vi.fn(),
    runPipelineExplore: vi.fn(),
    runPipelineFeature: vi.fn(),
    runPipelineCase: vi.fn(),
    runPipelineExecute: vi.fn(),
    runPipelineDefect: vi.fn(),
    featureAddRow: vi.fn(),
    featureUpdateRow: vi.fn(),
    featureRemoveRow: vi.fn(),
    featureConfirm: vi.fn(),
    featureUnconfirm: vi.fn(),
    featureToggleReview: vi.fn(),
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
    loginStatusLabel,
  };
  mockUseApp.mockReturnValue(actions as any);
  return actions;
};

const getBrand = () => within(document.querySelector('.brand')!).getByText(/TestMaster/);
const getCrumbs = () => document.querySelector('.crumbs')!;
const getPill = () => document.querySelector('.pill')!;
const getSide = () => document.querySelector('aside.side')!;
const getTopbar = () => document.querySelector('header.topbar')!;

beforeEach(() => {
  vi.clearAllMocks();
  setup();
});

describe('App 整体布局', () => {
  it('应渲染品牌标识', () => {
    render(<App />);
    expect(getBrand()).toBeInTheDocument();
  });

  it('面包屑应显示项目名和系统名', () => {
    render(<App />);
    const crumbs = getCrumbs();
    expect(within(crumbs).getByText(/Test Project/)).toBeInTheDocument();
    expect(within(crumbs).getByText(/Test System/)).toBeInTheDocument();
  });

  it('已登录状态应显示 ✓ 标识', () => {
    render(<App />);
    expect(within(getPill()).getByText(/✓/)).toBeInTheDocument();
  });

  it('未登录状态应显示 ○ 标识', () => {
    setup({ system: { ...createMock().system, loginStatus: 'logged_out' } });
    render(<App />);
    expect(within(getPill()).getByText(/○/)).toBeInTheDocument();
  });

  it('子系统应显示父门户面包屑', () => {
    setup({
      system: { ...createMock().system, type: 'subsystem', parent: 'Parent Portal' },
    });
    render(<App />);
    const crumbs = getCrumbs();
    expect(within(crumbs).getByText(/Parent Portal/)).toBeInTheDocument();
  });

  it('顶栏应包含退出登录按钮', () => {
    render(<App />);
    expect(within(getTopbar()).getByText('退出登录')).toBeInTheDocument();
  });

  it('顶栏应包含播放下一步按钮', () => {
    render(<App />);
    expect(within(getTopbar()).getByText(/播放下一步/)).toBeInTheDocument();
  });

  it('未登录时按钮显示"连接系统"', () => {
    setup({ system: { ...createMock().system, loginStatus: 'logged_out' } });
    render(<App />);
    expect(within(getTopbar()).getByText('连接系统')).toBeInTheDocument();
  });
});

describe('App 侧边栏导航', () => {
  const navItems = [
    { label: '工作台', key: 's1' },
    { label: '系统探索', key: 's2' },
    { label: '功能点审核', key: 's3' },
    { label: '测试用例', key: 's4' },
    { label: '执行', key: 's5' },
    { label: '缺陷', key: 's6' },
    { label: '日志管理', key: 's8' },
    { label: 'AI 模型配置', key: 's7' },
    { label: '项目管理', key: 's9' },
    { label: '知识库', key: 's10' },
  ];

  it('侧边栏应包含所有导航项', () => {
    render(<App />);
    const side = getSide();
    navItems.forEach(({ label }) => {
      expect(within(side).getByText(new RegExp(label))).toBeInTheDocument();
    });
  });

  it('三个分组应正确显示', () => {
    render(<App />);
    const side = getSide();
    expect(within(side).getByText('流水线')).toBeInTheDocument();
    expect(within(side).getByText('系统')).toBeInTheDocument();
    expect(within(side).getByText('项目')).toBeInTheDocument();
  });

  it('流水线分组应包含6个项', () => {
    render(<App />);
    const side = getSide();
    const items = within(side).getAllByText(/工作台|系统探索|功能点审核|测试用例|执行|缺陷/);
    expect(items.length).toBeGreaterThanOrEqual(6);
  });

  it('点击每个导航项应调用 setActiveScreen 并传递正确的 key', () => {
    const mock = setup();
    render(<App />);
    const side = getSide();
    navItems.forEach(({ label, key }) => {
      fireEvent.click(within(side).getByText(new RegExp(label)));
      expect(mock.setActiveScreen).toHaveBeenCalledWith(key);
    });
  });

  it('当前激活项应高亮', () => {
    render(<App />);
    const side = getSide();
    const activeBtn = side.querySelector('button.nav.active');
    expect(activeBtn).not.toBeNull();
  });
});

describe('App 按钮交互', () => {
  it('已登录时点击退出应调用 setLoginStatus(logged_out)', () => {
    const mock = setup();
    render(<App />);
    fireEvent.click(within(getTopbar()).getByText('退出登录'));
    expect(mock.setLoginStatus).toHaveBeenCalledWith('s1', 'logged_out');
  });

  it('退出登录应添加活动记录', () => {
    const mock = setup();
    render(<App />);
    fireEvent.click(within(getTopbar()).getByText('退出登录'));
    expect(mock.addActivity).toHaveBeenCalled();
  });

  it('未登录时点击连接应调用 setLoginStatus(logging_in)', () => {
    const mock = setup({ system: { ...createMock().system, loginStatus: 'logged_out' } });
    render(<App />);
    fireEvent.click(within(getTopbar()).getByText('连接系统'));
    expect(mock.setLoginStatus).toHaveBeenCalledWith('s1', 'logging_in');
  });
});

describe('App 端到端导航流程', () => {
  it('完整流水线导航顺序', () => {
    const mock = setup();
    render(<App />);
    const side = getSide();

    fireEvent.click(within(side).getByText(/系统探索/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s2');

    fireEvent.click(within(side).getByText(/功能点审核/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s3');

    fireEvent.click(within(side).getByText(/测试用例/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s4');

    fireEvent.click(within(side).getByText(/执行/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s5');

    fireEvent.click(within(side).getByText(/缺陷/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s6');
  });

  it('辅助功能导航顺序', () => {
    const mock = setup();
    render(<App />);
    const side = getSide();

    fireEvent.click(within(side).getByText(/AI 模型配置/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s7');

    fireEvent.click(within(side).getByText(/日志管理/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s8');

    fireEvent.click(within(side).getByText(/项目管理/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s9');

    fireEvent.click(within(side).getByText(/知识库/));
    expect(mock.setActiveScreen).toHaveBeenCalledWith('s10');
  });
});