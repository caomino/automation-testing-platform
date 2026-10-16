import { PageNodeDescriptor } from './types.js';

/**
 * Fantastic-admin 专业版真实 4 分栏全量子树拓扑 (像素级对齐官网 demo 真实界面)
 * 1. 【演示 (Demo)】: 真实包含 21 个子模块
 * 2. 【UI (三方组件库)】: 真实包含 7 大三方 UI 预设
 * 3. 【页面 (Pages)】: 通用、文件管理、看板
 * 4. 【生态 (Ecosystem)】: 官方周边 (3项)、友情推荐 (5项)
 */
export function getFantasticAdminTrue4TabTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
  return [
    {
      id: `${prefix}_tab_demo`,
      title: '演示 (Demo)',
      routePath: '/style_example',
      level: 1,
      actions: [],
      children: [
        {
          id: `${prefix}_p_style_lab`,
          title: '风格实验室 (Style Lab)',
          routePath: '/style_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_style_random`, title: '随机切换风格', type: 'update', selector: isAi ? "role=button[name='随机切换风格']" : "button:has-text('随机切换风格'), button:has-text('立即切换')", method: 'PUT' },
            { id: `${prefix}_act_style_theme`, title: '多主题亮暗配色切换', type: 'update', selector: isAi ? "role=region, .theme-card" : ".theme-card", method: 'PUT' }
          ]
        },
        {
          id: `${prefix}_p_multilevel`,
          title: '多级导航 (Multilevel Nav)',
          routePath: '/multilevel_menu_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_ml_nav_jump`, title: '多级导航路由跳转', type: 'query', selector: isAi ? "role=link" : "a", method: 'GET' }
          ],
          children: [
            { id: `${prefix}_p_ml_sub1`, title: '导航 2-1 (Sub 2-1)', routePath: '/multilevel_menu_example/page', level: 3, actions: [{ id: `${prefix}_act_ml_sub1_view`, title: '查看二级菜单内容', type: 'query', selector: isAi ? "role=region" : ".page-content", method: 'GET' }] },
            { id: `${prefix}_p_ml_sub2`, title: '导航 2-2 (三级嵌套菜单)', routePath: '/multilevel_menu_example/level2/page', level: 3, actions: [{ id: `${prefix}_act_ml_sub2_view`, title: '展开三级嵌套路由', type: 'query', selector: isAi ? "role=region" : ".page-content", method: 'GET' }] }
          ]
        },
        {
          id: `${prefix}_p_breadcrumb`,
          title: '面包屑导航 (Breadcrumb)',
          routePath: '/breadcrumb_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_bread_click`, title: '点击面包屑快速回溯路径', type: 'query', selector: isAi ? "role=navigation, .el-breadcrumb" : ".el-breadcrumb", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_keepalive`,
          title: '页面保活 (KeepAlive)',
          routePath: '/keep_alive_example/page',
          level: 2,
          actions: [
            { id: `${prefix}_act_keepalive_test`, title: '表单缓存保活测试', type: 'create', selector: isAi ? "role=button[name='缓存测试']" : "button:has-text('测试')", method: 'POST', formFields: ['input_test', 'timestamp'] },
            { id: `${prefix}_act_keepalive_reset`, title: '重置表单并清除缓存', type: 'delete', selector: isAi ? "role=button[name='清空']" : "button:has-text('重置')", method: 'DELETE' }
          ]
        },
        {
          id: `${prefix}_p_always_expand`,
          title: '始终展开 PRO (Always Expand)',
          routePath: '/always_expand_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_expand_toggle`, title: '侧边栏子菜单常驻展开', type: 'update', selector: isAi ? "role=switch" : ".el-switch", method: 'PUT' }
          ]
        },
        {
          id: `${prefix}_p_dynamic_badge`,
          title: '动态导航徽章 PRO (Nav Badge)',
          routePath: '/badge_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_badge_set`, title: '设置/清空导航小红点徽章', type: 'update', selector: isAi ? "role=button[name='设置徽章']" : "button:has-text('徽章')", method: 'POST' }
          ]
        },
        {
          id: `${prefix}_p_icon_active`,
          title: '导航图标激活 PRO (Active Icon)',
          routePath: '/icon_active_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_icon_active_switch`, title: '切换高亮选中态图标', type: 'update', selector: isAi ? "role=button" : ".icon-switch", method: 'PUT' }
          ]
        },
        {
          id: `${prefix}_p_param_nav`,
          title: '带参导航 PRO (Param Nav)',
          routePath: '/params_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_param_push`, title: '传递 Query/Params 路由参数跳转', type: 'query', selector: isAi ? "role=button[name='传参跳转']" : "button:has-text('跳转')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_center_layout`,
          title: '居中布局 PRO (Center Layout)',
          routePath: '/center_layout_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_center_layout_toggle`, title: '切换为定宽内容居中布局', type: 'update', selector: isAi ? "role=radio" : ".layout-radio", method: 'PUT' }
          ]
        },
        {
          id: `${prefix}_p_tabbar`,
          title: '标签栏 (Tabbar Engine)',
          routePath: '/tabbar_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_tabbar_close_other`, title: '关闭其他标签页', type: 'delete', selector: isAi ? "role=menuitem[name='关闭其他']" : "button:has-text('关闭其他')", method: 'DELETE' },
            { id: `${prefix}_act_tabbar_refresh`, title: '刷新当前活动标签', type: 'query', selector: isAi ? "role=menuitem[name='刷新']" : "button:has-text('刷新')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_components`,
          title: '组件 (Components)',
          routePath: '/component_basic_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_comp_btn_preview`, title: '预览基础组件形态', type: 'detail', selector: isAi ? "role=button[name='预览']" : "button:has-text('预览')", method: 'GET' },
            { id: `${prefix}_act_comp_copy_code`, title: '复制组件源码', type: 'query', selector: isAi ? "role=button[name='复制代码']" : "button:has-text('复制代码')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_components_pro`,
          title: '组件 PRO (Components PRO)',
          routePath: '/component_extend_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_comp_batch_upload`, title: '批量图片上传与裁剪', type: 'import', selector: isAi ? "role=button[name='上传']" : "button:has-text('上传')", method: 'POST' },
            { id: `${prefix}_act_comp_pcas`, title: '省市区级联联动选择', type: 'query', selector: isAi ? "role=combobox" : ".el-cascader", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_icons`,
          title: '图标 (Icon Center)',
          routePath: '/icon_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_icon_search`, title: '搜索全站 SVG/Font 图标', type: 'query', selector: isAi ? "role=searchbox" : "input[placeholder*='搜索']", method: 'GET' },
            { id: `${prefix}_act_icon_copy`, title: '复制图标类名与 SVG 标签', type: 'query', selector: isAi ? "role=button[name='复制']" : ".icon-item", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_page_container`,
          title: '布局容器 PRO (Page Container PRO)',
          routePath: '/page_container_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_container_switch`, title: '切换卡片与自适应滚动视图', type: 'update', selector: isAi ? "role=radio" : ".layout-radio", method: 'PUT' }
          ]
        },
        {
          id: `${prefix}_p_features`,
          title: '功能 (Features)',
          routePath: '/feature_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_feat_search`, title: '全站模糊搜索面板', type: 'query', selector: isAi ? "role=button[name='搜索']" : "button:has-text('搜索')", method: 'GET' },
            { id: `${prefix}_act_feat_print`, title: '打印当前 DOM 区域', type: 'export', selector: isAi ? "role=button[name='打印']" : "button:has-text('打印')", method: 'POST' },
            { id: `${prefix}_act_feat_watermark`, title: '注入安全防伪水印', type: 'update', selector: isAi ? "role=button[name='创建水印']" : "button:has-text('水印')", method: 'POST' }
          ]
        },
        {
          id: `${prefix}_p_plugins_pro`,
          title: '插件 PRO (Plugins PRO)',
          routePath: '/plugin_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_plugin_preview`, title: '加载富文本/图表/代码编辑器插件', type: 'detail', selector: isAi ? "role=region" : ".plugin-card", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_pages_pro`,
          title: '页面 PRO (Pages PRO)',
          routePath: '/pages_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_page_custom_table`, title: '查看高级自定义表格 CRUD', type: 'query', selector: isAi ? "role=button[name='查询']" : "button:has-text('查询')", method: 'GET' },
            { id: `${prefix}_act_page_result_success`, title: '查看操作成功结果页', type: 'detail', selector: isAi ? "role=button[name='返回']" : "button:has-text('返回')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_auth`,
          title: '权限验证 (Auth & Roles)',
          routePath: '/auth_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_switch_admin`, title: '切换为系统管理员 (admin)', type: 'auth', selector: isAi ? "role=button[name='admin']" : "button:has-text('admin')", method: 'PUT' },
            { id: `${prefix}_act_switch_editor`, title: '切换为内容编辑员 (editor)', type: 'auth', selector: isAi ? "role=button[name='editor']" : "button:has-text('editor')", method: 'PUT' },
            { id: `${prefix}_act_perm_verify`, title: '鉴权指令与按钮权限鉴别', type: 'query', selector: isAi ? "role=button[name='权限检查']" : "button:has-text('权限')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_external_links`,
          title: '外部链接 (External Links)',
          routePath: '/external_link_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_open_external`, title: '在新窗口打开外链站点', type: 'query', selector: isAi ? "role=link" : "a", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_error_pages`,
          title: '错误页面 (Error Pages)',
          routePath: '/404',
          level: 2,
          actions: [
            { id: `${prefix}_act_err_404`, title: '访问 404 页面丢失页', type: 'query', selector: isAi ? "role=button[name='回到首页']" : "button:has-text('首页')", method: 'GET' },
            { id: `${prefix}_act_err_403`, title: '访问 403 无权限页面', type: 'query', selector: isAi ? "role=button[name='重新登录']" : "button:has-text('登录')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_sponsor_pro`,
          title: '赞助 PRO (Sponsor)',
          routePath: '/sponsor_example',
          level: 2,
          actions: [
            { id: `${prefix}_act_sponsor_view`, title: '查看商业授权与赞助权益', type: 'detail', selector: isAi ? "role=region" : ".sponsor-box", method: 'GET' }
          ]
        }
      ]
    },
    {
      id: `${prefix}_tab_ui`,
      title: 'UI (三方组件库)',
      routePath: '/ui',
      level: 1,
      actions: [],
      children: [
        {
          id: `${prefix}_p_ui_ant_design_vue`,
          title: 'Ant Design Vue (预设模版)',
          routePath: '/ui/antd',
          level: 2,
          actions: [
            { id: `${prefix}_act_ui_antd_preview`, title: '预览 Ant Design Vue 组件与表单', type: 'detail', selector: isAi ? "role=link[name*='Ant Design Vue']" : "a:has-text('Ant Design Vue')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_ui_antdv_next`,
          title: 'Antdv Next (预设模版)',
          routePath: '/ui/antdv-next',
          level: 2,
          actions: [
            { id: `${prefix}_act_ui_antdv_next_preview`, title: '预览 Antdv Next 开箱即用模版', type: 'detail', selector: isAi ? "role=link[name*='Antdv Next']" : "a:has-text('Antdv Next')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_ui_arco_design`,
          title: 'Arco Design Vue (预设模版)',
          routePath: '/ui/arco',
          level: 2,
          actions: [
            { id: `${prefix}_act_ui_arco_preview`, title: '预览 Arco Design Vue 字节跳动规范模版', type: 'detail', selector: isAi ? "role=link[name*='Arco Design Vue']" : "a:has-text('Arco Design Vue')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_ui_element_plus`,
          title: 'Element Plus (预设模版)',
          routePath: '/ui/element-plus',
          level: 2,
          actions: [
            { id: `${prefix}_act_ui_el_preview`, title: '预览 Element Plus 经典模版', type: 'detail', selector: isAi ? "role=link[name*='Element Plus']" : "a:has-text('Element Plus')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_ui_naive_ui`,
          title: 'Naive UI (预设模版)',
          routePath: '/ui/naive-ui',
          level: 2,
          actions: [
            { id: `${prefix}_act_ui_naive_preview`, title: '预览 Naive UI 图森未来全量组件', type: 'detail', selector: isAi ? "role=link[name*='Naive UI']" : "a:has-text('Naive UI')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_ui_tdesign`,
          title: 'TDesign (预设模版)',
          routePath: '/ui/tdesign',
          level: 2,
          actions: [
            { id: `${prefix}_act_ui_tdesign_preview`, title: '预览 Tencent TDesign 腾讯组件库', type: 'detail', selector: isAi ? "role=link[name*='TDesign']" : "a:has-text('TDesign')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_ui_vexip_ui`,
          title: 'Vexip UI (预设模版)',
          routePath: '/ui/vexip-ui',
          level: 2,
          actions: [
            { id: `${prefix}_act_ui_vexip_preview`, title: '预览 Vexip UI 现代化高定制组件模版', type: 'detail', selector: isAi ? "role=link[name*='Vexip UI']" : "a:has-text('Vexip UI')", method: 'GET' }
          ]
        }
      ]
    },
    {
      id: `${prefix}_tab_page`,
      title: '页面 (Pages)',
      routePath: '/pages',
      level: 1,
      actions: [],
      children: [
        {
          id: `${prefix}_p_page_general`,
          title: '通用 (General Pages)',
          routePath: '/pages/general',
          level: 2,
          actions: [
            { id: `${prefix}_act_page_gen_view`, title: '查看通用页面列表与表单', type: 'query', selector: isAi ? "role=region" : ".page-content", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_page_file_manage`,
          title: '文件管理 (File Management)',
          routePath: '/pages/file_manager',
          level: 2,
          tableColumns: ['文件名', '文件大小', '类型', '修改时间', '操作'],
          actions: [
            { id: `${prefix}_act_file_upload`, title: '上传文件与附件', type: 'import', selector: isAi ? "role=button[name='上传']" : "button:has-text('上传')", method: 'POST' },
            { id: `${prefix}_act_file_delete`, title: '删除文件', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'DELETE' }
          ]
        },
        {
          id: `${prefix}_p_page_kanban`,
          title: '看板 (Kanban Board)',
          routePath: '/pages/kanban',
          level: 2,
          tableColumns: ['待办 (To Do)', '进行中 (In Progress)', '已完成 (Done)'],
          actions: [
            { id: `${prefix}_act_kanban_add_card`, title: '新增看板任务卡片', type: 'create', selector: isAi ? "role=button[name='新增任务']" : "button:has-text('新增')", method: 'POST', formFields: ['task_title', 'assignee', 'priority'] },
            { id: `${prefix}_act_kanban_drag`, title: '拖拽流转卡片状态', type: 'update', selector: isAi ? "role=region, .kanban-column" : ".kanban-column", method: 'PUT' }
          ]
        }
      ]
    },
    {
      id: `${prefix}_tab_ecosystem`,
      title: '生态 (Ecosystem)',
      routePath: '/ecosystem',
      level: 1,
      actions: [],
      children: [
        {
          id: `${prefix}_p_eco_official`,
          title: '官方周边 (Official Products)',
          routePath: '/ecosystem/official',
          level: 2,
          actions: [
            { id: `${prefix}_act_eco_startkit`, title: 'Fantastic-startkit 快速起步模版', type: 'query', selector: isAi ? "role=link[name*='startkit']" : "a:has-text('startkit')", method: 'GET' },
            { id: `${prefix}_act_eco_onestep`, title: 'One-step-admin 中后台集成框架', type: 'query', selector: isAi ? "role=link[name*='One-step']" : "a:has-text('One-step')", method: 'GET' },
            { id: `${prefix}_act_eco_mobile`, title: 'Fantastic-mobile 移动端多端方案', type: 'query', selector: isAi ? "role=link[name*='mobile']" : "a:has-text('mobile')", method: 'GET' }
          ]
        },
        {
          id: `${prefix}_p_eco_recommend`,
          title: '友情推荐 (Friendly Recommendations)',
          routePath: '/ecosystem/recommend',
          level: 2,
          actions: [
            { id: `${prefix}_act_eco_vform`, title: 'VForm 低代码表单构建器', type: 'query', selector: isAi ? "role=link[name*='VForm']" : "a:has-text('VForm')", method: 'GET' },
            { id: `${prefix}_act_eco_formcreate`, title: 'FormCreate 动态表单引擎', type: 'query', selector: isAi ? "role=link[name*='FormCreate']" : "a:has-text('FormCreate')", method: 'GET' },
            { id: `${prefix}_act_eco_vexip`, title: 'Vexip UI 高定组件生态', type: 'query', selector: isAi ? "role=link[name*='Vexip']" : "a:has-text('Vexip')", method: 'GET' },
            { id: `${prefix}_act_eco_mineadmin`, title: 'MineAdmin 开源分布式中后台', type: 'query', selector: isAi ? "role=link[name*='MineAdmin']" : "a:has-text('MineAdmin')", method: 'GET' },
            { id: `${prefix}_act_eco_antdv_comp`, title: 'Antdv Next 组件库生态', type: 'query', selector: isAi ? "role=link[name*='Antdv Next']" : "a:has-text('Antdv Next')", method: 'GET' }
          ]
        }
      ]
    }
  ];
}

