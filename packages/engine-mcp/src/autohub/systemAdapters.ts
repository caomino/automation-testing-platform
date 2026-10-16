import { PageNodeDescriptor, ActionDescriptor } from './types.js';
import { getFantasticAdminTrue4TabTree } from './fantasticFullTree';

/**
 * 模块化管理系统拓扑适配器库 (System Topology Adapters)
 * 严格对应各大官方开源/成熟后台的真实菜单目录与颗粒度功能点，杜绝虚构，代码高度复用与规范解耦
 */

export class SystemTopologyAdapters {
  /**
   * 1. Fantastic-admin 专业版真实 4 大顶级主导航与全量子树
   * 严格对照用户实测 UI 结构：【演示】、【UI】、【页面】、【生态】四大父 Tab 与全量子页面
   */
  static getFantasticAdminTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return getFantasticAdminTrue4TabTree(prefix, isAi);
  }

  /**
   * 2. Gin-Vue-Admin (GVA 官方体验系统 - http://demo.gin-vue-admin.com)
   * 真实全量 1:1 对齐官网实时左侧菜单 12 大父模块：
   * 1. 仪表盘  2. 权限管理  3. 组织管理  4. 系统设置  5. 运维监控  6. 媒体管理
   * 7. 编程辅助  8. AI 工坊  9. 示例文件  10. 插件系统  11. 官方网站  12. 关于我们
   */
  static getGinVueAdminTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_dashboard`,
        title: '仪表盘 (Dashboard)',
        routePath: '/dashboard',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_dash_main`,
            title: '控制台首页 (Workplace & Overview)',
            routePath: '/dashboard',
            level: 2,
            tableColumns: ['访问人数', '新增客户', '解决数量', '内容数据', '操作'],
            actions: [
              { id: `${prefix}_act_gva_refresh`, title: '刷新系统状态', type: 'query', selector: isAi ? "role=button[name='刷新']" : "button:has-text('刷新')", method: 'GET' },
              { id: `${prefix}_act_gva_quick_nav`, title: '快捷功能导航', type: 'query', selector: isAi ? "role=region, .quick-nav" : ".quick-nav-card, .el-card", method: 'GET' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_auth`,
        title: '权限管理 (Permission Control)',
        routePath: '/authority',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_role`,
            title: '角色管理 (Role Authority)',
            routePath: '/admin/authority',
            level: 2,
            tableColumns: ['角色ID', '角色名称', '操作'],
            actions: [
              { id: `${prefix}_act_gva_role_add`, title: '新增角色', type: 'create', selector: isAi ? "role=button[name='新增角色']" : "button:has-text('新增角色')", method: 'POST', apiEndpoint: '/authority/createAuthority', formFields: ['authorityId', 'authorityName'] },
              { id: `${prefix}_act_gva_role_perm`, title: '设置菜单与 API 权限', type: 'auth', selector: isAi ? "role=button[name='设置权限']" : "button:has-text('设置权限')", method: 'POST', apiEndpoint: '/authority/setDataAuthority' },
              { id: `${prefix}_act_gva_role_copy`, title: '拷贝角色权限', type: 'create', selector: isAi ? "role=button[name='拷贝']" : "button:has-text('拷贝')", method: 'POST', apiEndpoint: '/authority/copyAuthority' },
              { id: `${prefix}_act_gva_role_del`, title: '删除角色', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'POST', apiEndpoint: '/authority/deleteAuthority' }
            ]
          },
          {
            id: `${prefix}_p_gva_menu`,
            title: '菜单管理 (Menu Management)',
            routePath: '/admin/menu',
            level: 2,
            tableColumns: ['ID', '路由Name', '路由Path', '是否隐藏', '父节点', '排序', '文件路径', '操作'],
            actions: [
              { id: `${prefix}_act_gva_menu_add`, title: '新增根菜单/子菜单', type: 'create', selector: isAi ? "role=button[name='新增根菜单']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/menu/addBaseMenu', formFields: ['name', 'path', 'component', 'title'] },
              { id: `${prefix}_act_gva_menu_edit`, title: '修改菜单配置', type: 'update', selector: isAi ? "role=button[name='编辑']" : "button:has-text('编辑')", method: 'POST', apiEndpoint: '/menu/updateBaseMenu' },
              { id: `${prefix}_act_gva_menu_del`, title: '删除菜单节点', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'POST', apiEndpoint: '/menu/deleteBaseMenu' }
            ]
          },
          {
            id: `${prefix}_p_gva_api`,
            title: 'api管理 (API Routes)',
            routePath: '/admin/api',
            level: 2,
            tableColumns: ['ID', 'API路径', 'API分组', '请求简介', '请求方法', '操作'],
            actions: [
              { id: `${prefix}_act_gva_api_query`, title: '查询 API 路由清单', type: 'query', selector: isAi ? "role=button[name='查询']" : "button:has-text('查询')", method: 'GET', apiEndpoint: '/api/getApiList' },
              { id: `${prefix}_act_gva_api_create`, title: '新增 api', type: 'create', selector: isAi ? "role=button[name='新增api']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/api/createApi', formFields: ['path', 'description', 'apiGroup', 'method'] },
              { id: `${prefix}_act_gva_api_del`, title: '删除 API 规则', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'POST', apiEndpoint: '/api/deleteApi' }
            ]
          },
          {
            id: `${prefix}_p_gva_api_token`,
            title: 'API Token (Token Management)',
            routePath: '/admin/token',
            level: 2,
            tableColumns: ['Token标识', '所属用户', '有效期', '创建时间', '状态', '操作'],
            actions: [
              { id: `${prefix}_act_gva_token_gen`, title: '生成新 API Token', type: 'create', selector: isAi ? "role=button[name='生成Token']" : "button:has-text('生成')", method: 'POST' },
              { id: `${prefix}_act_gva_token_revoke`, title: '吊销与作废 Token', type: 'delete', selector: isAi ? "role=button[name='吊销']" : "button:has-text('吊销')", method: 'DELETE' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_org`,
        title: '组织管理 (Organization)',
        routePath: '/organization',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_user`,
            title: '用户管理 (User Management)',
            routePath: '/admin/user',
            level: 2,
            tableColumns: ['头像', '用户名', '昵称', '角色', '手机号', '邮箱', '状态', '操作'],
            actions: [
              { id: `${prefix}_act_gva_user_search`, title: '搜索用户列表', type: 'query', selector: isAi ? "role=button[name='查询']" : "button:has-text('查询')", method: 'GET', apiEndpoint: '/user/getUserList' },
              { id: `${prefix}_act_gva_user_add`, title: '新增用户', type: 'create', selector: isAi ? "role=button[name='新增用户']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/user/register', formFields: ['username', 'password', 'nickName', 'authorityId'] },
              { id: `${prefix}_act_gva_user_edit`, title: '编辑用户', type: 'update', selector: isAi ? "role=button[name='编辑']" : "button:has-text('编辑')", method: 'PUT', apiEndpoint: '/user/setUserInfo' },
              { id: `${prefix}_act_gva_user_del`, title: '删除用户', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'DELETE', apiEndpoint: '/user/deleteUser' },
              { id: `${prefix}_act_gva_user_reset_pwd`, title: '重置用户密码', type: 'update', selector: isAi ? "role=button[name='重置密码']" : "button:has-text('重置密码')", method: 'POST', apiEndpoint: '/user/resetPassword' }
            ]
          },
          {
            id: `${prefix}_p_gva_dept`,
            title: '部门管理 (Departments)',
            routePath: '/organization/department',
            level: 2,
            tableColumns: ['部门ID', '部门名称', '负责人', '排序', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_gva_dept_add`, title: '新增部门节点', type: 'create', selector: isAi ? "role=button[name='新增部门']" : "button:has-text('新增')", method: 'POST' },
              { id: `${prefix}_act_gva_dept_del`, title: '删除部门', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'DELETE' }
            ]
          },
          {
            id: `${prefix}_p_gva_post`,
            title: '岗位管理 (Positions)',
            routePath: '/organization/position',
            level: 2,
            tableColumns: ['岗位ID', '岗位名称', '岗位编码', '状态', '操作'],
            actions: [
              { id: `${prefix}_act_gva_post_add`, title: '新增岗位', type: 'create', selector: isAi ? "role=button[name='新增岗位']" : "button:has-text('新增')", method: 'POST' },
              { id: `${prefix}_act_gva_post_del`, title: '删除岗位', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'DELETE' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_sys_setting`,
        title: '系统设置 (System Settings)',
        routePath: '/system',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_dict`,
            title: '字典管理 (Dictionary)',
            routePath: '/admin/dictionary',
            level: 2,
            tableColumns: ['字典名(中)', '字典名(英)', '状态', '描述', '操作'],
            actions: [
              { id: `${prefix}_act_gva_dict_add`, title: '新增字典项', type: 'create', selector: isAi ? "role=button[name='新增字典']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/sysDictionary/createSysDictionary' },
              { id: `${prefix}_act_gva_dict_detail`, title: '查看字典详情', type: 'detail', selector: isAi ? "role=button[name='详情']" : "button:has-text('详情')", method: 'GET' }
            ]
          },
          {
            id: `${prefix}_p_gva_sys_config`,
            title: '系统配置 (System Config)',
            routePath: '/system/config',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_cfg_save`, title: '保存系统全局配置', type: 'update', selector: isAi ? "role=button[name='保存配置']" : "button:has-text('保存')", method: 'POST', apiEndpoint: '/system/setSystemConfig' }
            ]
          },
          {
            id: `${prefix}_p_gva_jwt`,
            title: 'JWT管理 (JWT Manager)',
            routePath: '/system/jwt',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_jwt_flush`, title: '重置 JWT 密钥与黑名单', type: 'update', selector: isAi ? "role=button[name='刷新密钥']" : "button:has-text('密钥')", method: 'POST', apiEndpoint: '/jwt/jsonInBlackList' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_monitor`,
        title: '运维监控 (Operations Monitoring)',
        routePath: '/monitor',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_oper_log`,
            title: '操作历史 (Operation History)',
            routePath: '/monitor/operationRecord',
            level: 2,
            tableColumns: ['请求IP', '请求方法', '请求路径', '状态码', '响应耗时', '操作人', '操作时间', '操作'],
            actions: [
              { id: `${prefix}_act_gva_log_query`, title: '条件搜索操作日志', type: 'query', selector: isAi ? "role=button[name='搜索']" : "button:has-text('搜索')", method: 'GET', apiEndpoint: '/sysOperationRecord/getSysOperationRecordList' },
              { id: `${prefix}_act_gva_log_del_batch`, title: '批量删除操作日志', type: 'batch_delete', selector: isAi ? "role=button[name='批量删除']" : "button:has-text('批量删除')", method: 'DELETE', apiEndpoint: '/sysOperationRecord/deleteSysOperationRecordByIds' }
            ]
          },
          {
            id: `${prefix}_p_gva_server`,
            title: '服务器状态 (Server Status)',
            routePath: '/monitor/server',
            level: 2,
            tableColumns: ['指标项', '硬件核心参数', '当前利用率', '状态'],
            actions: [
              { id: `${prefix}_act_gva_server_info`, title: '获取 CPU/内存/磁盘/Go运行时状态', type: 'query', selector: isAi ? "role=region" : ".el-card", method: 'GET', apiEndpoint: '/system/getServerInfo' }
            ]
          },
          {
            id: `${prefix}_p_gva_cron`,
            title: '定时任务 (Cron Tasks)',
            routePath: '/monitor/cron',
            level: 2,
            tableColumns: ['任务名称', 'Cron表达式', '执行状态', '备注', '操作'],
            actions: [
              { id: `${prefix}_act_gva_cron_create`, title: '新增定时任务', type: 'create', selector: isAi ? "role=button[name='新增任务']" : "button:has-text('新增')", method: 'POST' },
              { id: `${prefix}_act_gva_cron_run`, title: '立即执行一次', type: 'query', selector: isAi ? "role=button[name='执行一次']" : "button:has-text('执行')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_media`,
        title: '媒体管理 (Media Management)',
        routePath: '/media',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_file_upload`,
            title: '文件上传 (File Upload)',
            routePath: '/media/upload',
            level: 2,
            tableColumns: ['预览', '文件名', '存储路径', '文件大小', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_gva_media_up`, title: '上传多媒体附件', type: 'import', selector: isAi ? "role=button[name='上传']" : "button:has-text('上传')", method: 'POST' },
              { id: `${prefix}_act_gva_media_del`, title: '删除文件', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'DELETE' }
            ]
          },
          {
            id: `${prefix}_p_gva_gallery`,
            title: '媒体库 (Media Gallery)',
            routePath: '/media/gallery',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_gallery_view`, title: '浏览资源图库', type: 'query', selector: isAi ? "role=region" : ".gallery-grid", method: 'GET' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_coding_tools`,
        title: '编程辅助 (Coding Tools)',
        routePath: '/autoCode',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_autocode_main`,
            title: '自动化代码 (Auto Code)',
            routePath: '/autoCode/code',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_gen_code`, title: '一键生成前后端 CRUD 代码', type: 'create', selector: isAi ? "role=button[name='生成代码']" : "button:has-text('生成代码')", method: 'POST', apiEndpoint: '/autoCode/createTemp' },
              { id: `${prefix}_act_gva_gen_preview`, title: '预览生成代码结构', type: 'detail', selector: isAi ? "role=button[name='预览代码']" : "button:has-text('预览')", method: 'GET', apiEndpoint: '/autoCode/preview' }
            ]
          },
          {
            id: `${prefix}_p_gva_form_designer`,
            title: '表单设计器 (Form Designer)',
            routePath: '/autoCode/form',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_form_build`, title: '可视化拖拽生成表单', type: 'create', selector: isAi ? "role=region" : ".form-designer", method: 'POST' }
            ]
          },
          {
            id: `${prefix}_p_gva_autopkg`,
            title: '自动化包 (Auto Pkg)',
            routePath: '/autoCode/pkg',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_pkg_build`, title: '创建自动化 Package 插件', type: 'create', selector: isAi ? "role=button[name='创建Package']" : "button:has-text('创建')", method: 'POST', apiEndpoint: '/autoCode/createPkg' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_ai_workshop`,
        title: 'AI 工坊 (AI Workshop)',
        routePath: '/ai',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_ai_chat`,
            title: 'AI 对话助手 (AI Chat Agent)',
            routePath: '/ai/chat',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_ai_ask`, title: '发起 AI 智能问答与代码补全', type: 'create', selector: isAi ? "role=textbox, input[placeholder*='输入问题']" : "textarea", method: 'POST' }
            ]
          },
          {
            id: `${prefix}_p_gva_ai_kb`,
            title: '知识库 (Knowledge Base)',
            routePath: '/ai/knowledge',
            level: 2,
            tableColumns: ['知识库名称', '文档总数', '向量状态', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_gva_kb_create`, title: '创建知识库与导入文档', type: 'create', selector: isAi ? "role=button[name='创建知识库']" : "button:has-text('创建')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_example_files`,
        title: '示例文件 (Example Files)',
        routePath: '/example',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_customer`,
            title: '客户管理 (Customer CRM)',
            routePath: '/example/customer',
            level: 2,
            tableColumns: ['ID', '客户名', '客户手机号', '负责员工', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_gva_cust_create`, title: '新增客户档案', type: 'create', selector: isAi ? "role=button[name='新增客户']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/exaCustomer/createExaCustomer', formFields: ['customerName', 'customerPhoneData'] },
              { id: `${prefix}_act_gva_cust_edit`, title: '编辑修改客户信息', type: 'update', selector: isAi ? "role=button[name='编辑']" : "button:has-text('编辑')", method: 'PUT', apiEndpoint: '/exaCustomer/updateExaCustomer' },
              { id: `${prefix}_act_gva_cust_del`, title: '删除客户档案', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'DELETE', apiEndpoint: '/exaCustomer/deleteExaCustomer' }
            ]
          },
          {
            id: `${prefix}_p_gva_breakpoint`,
            title: '断点续传 (File Uploader)',
            routePath: '/example/breakpoint',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_upload_chunk`, title: '大文件分片断点续传', type: 'import', selector: isAi ? "role=button[name='上传']" : "button:has-text('上传')", method: 'POST', apiEndpoint: '/fileUploadAndDownload/breakpointContinue' },
              { id: `${prefix}_act_gva_remove_chunk`, title: '清理未完成分片缓存', type: 'delete', selector: isAi ? "role=button[name='清理分片']" : "button:has-text('清理')", method: 'POST', apiEndpoint: '/fileUploadAndDownload/removeChunk' }
            ]
          },
          {
            id: `${prefix}_p_gva_export_tpl`,
            title: '导出模板 (Template Export)',
            routePath: '/example/template',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_tpl_export`, title: '导出 Excel 业务模板', type: 'export', selector: isAi ? "role=button[name='导出']" : "button:has-text('导出')", method: 'GET' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_plugin_sys`,
        title: '插件系统 (Plugin System)',
        routePath: '/plugin',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_plugin_market`,
            title: '插件市场 (Plugin Market)',
            routePath: '/plugin/market',
            level: 2,
            tableColumns: ['插件标识', '名称', '价格', '状态', '操作'],
            actions: [
              { id: `${prefix}_act_gva_plugin_buy`, title: '购买与在线安装插件', type: 'create', selector: isAi ? "role=button[name='安装']" : "button:has-text('安装')", method: 'POST', apiEndpoint: '/plugin/install' }
            ]
          },
          {
            id: `${prefix}_p_gva_plugin_installed`,
            title: '已装插件 (Installed Plugins)',
            routePath: '/plugin/installed',
            level: 2,
            tableColumns: ['插件标识', '名称', '版本', '启用状态', '操作'],
            actions: [
              { id: `${prefix}_act_gva_plugin_toggle`, title: '启用/停用插件', type: 'update', selector: isAi ? "role=switch" : ".el-switch", method: 'POST', apiEndpoint: '/plugin/setPlugin' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_official_web`,
        title: '官方网站 (Official Website)',
        routePath: '/official',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_official_link`,
            title: '官方网站链接 (Official Site)',
            routePath: '/official/site',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_open_official`, title: '跳转打开官方主页', type: 'query', selector: isAi ? "role=link" : "a", method: 'GET' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_about`,
        title: '关于我们 (About Us)',
        routePath: '/about',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_p_gva_about_info`,
            title: '关于我们与商业授权 (About & License)',
            routePath: '/about/us',
            level: 2,
            actions: [
              { id: `${prefix}_act_gva_view_license`, title: '查看框架开源协议与商业授权', type: 'detail', selector: isAi ? "role=region" : ".about-container", method: 'GET' }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 3. Go-Admin 官方标准 (Golang + Vue2/Vue3/Antd + Casbin) - 真实 5 大一级模块
   */
  static getGoAdminTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_dashboard`,
        title: '首页 (Dashboard)',
        routePath: '/dashboard',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_goadm_workplace`,
            title: '工作台 (Workplace)',
            routePath: '/dashboard/workplace',
            level: 2,
            tableColumns: ['快捷入口', '项目数', '待办事项', '动态', '团队成员', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_refresh`, title: '刷新工作台概览', type: 'query', selector: isAi ? "role=button[name='刷新']" : "button:has-text('刷新')", method: 'GET' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_system`,
        title: '系统管理 (System Management)',
        routePath: '/system',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_goadm_user`,
            title: '用户管理 (SysUser)',
            routePath: '/system/sys-user',
            level: 2,
            tableColumns: ['用户ID', '用户名', '昵称', '部门', '手机号码', '状态', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_user_query`, title: '搜索用户', type: 'query', selector: isAi ? "role=button[name='搜索']" : "button:has-text('搜索')", method: 'GET', apiEndpoint: '/api/v1/sys-user' },
              { id: `${prefix}_act_goadm_user_add`, title: '添加用户', type: 'create', selector: isAi ? "role=button[name='新增']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/api/v1/sys-user', formFields: ['username', 'nickName', 'password', 'roleId', 'deptId', 'phone', 'email'] },
              { id: `${prefix}_act_goadm_user_edit`, title: '修改用户资料', type: 'update', selector: isAi ? "role=button[name='修改']" : "button:has-text('修改')", method: 'PUT', apiEndpoint: '/api/v1/sys-user' },
              { id: `${prefix}_act_goadm_user_del`, title: '删除用户', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'DELETE', apiEndpoint: '/api/v1/sys-user' }
            ]
          },
          {
            id: `${prefix}_page_goadm_role`,
            title: '角色管理 (SysRole)',
            routePath: '/system/sys-role',
            level: 2,
            tableColumns: ['角色编号', '角色名称', '权限字符', '显示顺序', '状态', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_role_add`, title: '新增角色', type: 'create', selector: isAi ? "role=button[name='新增']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/api/v1/sys-role', formFields: ['roleName', 'roleKey', 'roleSort', 'status'] },
              { id: `${prefix}_act_goadm_role_auth`, title: '数据与菜单权限授权', type: 'auth', selector: isAi ? "role=button[name='数据权限']" : "button:has-text('数据权限')", method: 'PUT', apiEndpoint: '/api/v1/sys-role' }
            ]
          },
          {
            id: `${prefix}_page_goadm_menu`,
            title: '菜单管理 (SysMenu)',
            routePath: '/system/sys-menu',
            level: 2,
            tableColumns: ['菜单名称', '图标', '排序', '权限标识', '组件路径', '状态', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_menu_add`, title: '添加菜单路由', type: 'create', selector: isAi ? "role=button[name='新增']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/api/v1/sys-menu' }
            ]
          },
          {
            id: `${prefix}_page_goadm_dept`,
            title: '部门管理 (SysDept)',
            routePath: '/system/sys-dept',
            level: 2,
            tableColumns: ['部门名称', '排序', '状态', '创建时间', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_dept_add`, title: '添加子部门', type: 'create', selector: isAi ? "role=button[name='新增']" : "button:has-text('新增')", method: 'POST', apiEndpoint: '/api/v1/sys-dept' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_monitor`,
        title: '系统监控 (Monitor)',
        routePath: '/monitor',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_goadm_server`,
            title: '服务监控 (Server Info)',
            routePath: '/monitor/server',
            level: 2,
            tableColumns: ['CPU使用率', '内存使用率', '磁盘状态', 'Go运行版本', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_srv_refresh`, title: '刷新服务运行指标', type: 'query', selector: isAi ? "role=button[name='刷新']" : "button:has-text('刷新')", method: 'GET' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_tools`,
        title: '系统工具 (Tools & CodeGen)',
        routePath: '/tools',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_goadm_gen`,
            title: '代码生成 (Gen Table)',
            routePath: '/tools/gen',
            level: 2,
            tableColumns: ['表名称', '表描述', '实体类名', '创建时间', '更新时间', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_gen_import`, title: '导入数据库表结构', type: 'import', selector: isAi ? "role=button[name='导入']" : "button:has-text('导入')", method: 'POST' },
              { id: `${prefix}_act_goadm_gen_code`, title: '生成并下载前后端代码', type: 'create', selector: isAi ? "role=button[name='生成代码']" : "button:has-text('生成代码')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_logs`,
        title: '日志管理 (Log Auditing)',
        routePath: '/log',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_goadm_operlog`,
            title: '操作日志 (Operation Logs)',
            routePath: '/log/operlog',
            level: 2,
            tableColumns: ['日志编号', '系统模块', '操作类型', '操作人员', '主机IP', '状态', '操作时间', '操作'],
            actions: [
              { id: `${prefix}_act_goadm_log_clean`, title: '清理操作日志', type: 'delete', selector: isAi ? "role=button[name='清空']" : "button:has-text('清空')", method: 'DELETE' }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 4. AdminJS 官方全量资源管理体系 (Node.js + React)
   * 严格对应 7 个父资源菜单：Dashboard, Users, Posts, Comments, Categories, Companies, Profiles
   * 每个资源具备完整 List、Filter、Create、Show、Edit、Delete、BulkDelete 操作颗粒度
   */
  static getAdminJSTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_ajs_dash`,
        title: 'Dashboard (控制台总览)',
        routePath: '/admin',
        level: 1,
        actions: [
          { id: `${prefix}_act_ajs_dash_stats`, title: '查看全站业务统计与数据指标', type: 'query', selector: isAi ? "role=heading, .adminjs_Box" : "h1, .adminjs_Box", method: 'GET' },
          { id: `${prefix}_act_ajs_dash_quick_entry`, title: '快捷资源导航入口', type: 'query', selector: isAi ? "role=link" : "a.adminjs_Link", method: 'GET' }
        ]
      },
      {
        id: `${prefix}_mod_ajs_users`,
        title: 'Users (用户实体)',
        routePath: '/admin/resources/User',
        level: 1,
        tableColumns: ['ID', 'Email', 'Name', 'Role', 'CreatedAt', 'Actions'],
        actions: [
          { id: `${prefix}_act_ajs_u_list`, title: 'Filter & Search Users (列表检索)', type: 'query', selector: isAi ? "role=button[name='Filter']" : "button:has-text('Filter')", method: 'GET', formFields: ['email', 'name', 'role'] },
          { id: `${prefix}_act_ajs_u_new`, title: 'Create new User (新建用户)', type: 'create', selector: isAi ? "role=link[name='Create new']" : "a:has-text('Create new')", method: 'POST', formFields: ['email', 'password', 'name', 'role'] },
          { id: `${prefix}_act_ajs_u_show`, title: 'Show User Details (用户详情)', type: 'detail', selector: isAi ? "role=link[name='Show']" : "a:has-text('Show')", method: 'GET' },
          { id: `${prefix}_act_ajs_u_edit`, title: 'Edit User (编辑资料)', type: 'update', selector: isAi ? "role=link[name='Edit']" : "a:has-text('Edit')", method: 'POST', formFields: ['name', 'role'] },
          { id: `${prefix}_act_ajs_u_del`, title: 'Delete User (删除用户)', type: 'delete', selector: isAi ? "role=button[name='Delete']" : "button:has-text('Delete')", method: 'POST' },
          { id: `${prefix}_act_ajs_u_bulk_del`, title: 'Bulk Delete Users (批量删除)', type: 'batch_delete', selector: isAi ? "role=button[name='Bulk delete']" : "button:has-text('Bulk delete')", method: 'POST' }
        ]
      },
      {
        id: `${prefix}_mod_ajs_posts`,
        title: 'Posts (文章与动态)',
        routePath: '/admin/resources/Post',
        level: 1,
        tableColumns: ['ID', 'Title', 'Author', 'Status', 'PublishedAt', 'Actions'],
        actions: [
          { id: `${prefix}_act_ajs_p_filter`, title: 'Filter Posts (筛选文章)', type: 'query', selector: isAi ? "role=button[name='Filter']" : "button:has-text('Filter')", method: 'GET', formFields: ['title', 'status'] },
          { id: `${prefix}_act_ajs_p_new`, title: 'Create new Post (发布文章)', type: 'create', selector: isAi ? "role=link[name='Create new']" : "a:has-text('Create new')", method: 'POST', formFields: ['title', 'content', 'status', 'authorId'] },
          { id: `${prefix}_act_ajs_p_show`, title: 'View Post Content (查看详情)', type: 'detail', selector: isAi ? "role=link[name='Show']" : "a:has-text('Show')", method: 'GET' },
          { id: `${prefix}_act_ajs_p_edit`, title: 'Edit Post (编辑文章)', type: 'update', selector: isAi ? "role=link[name='Edit']" : "a:has-text('Edit')", method: 'POST', formFields: ['title', 'content', 'status'] },
          { id: `${prefix}_act_ajs_p_del`, title: 'Delete Post (删除文章)', type: 'delete', selector: isAi ? "role=button[name='Delete']" : "button:has-text('Delete')", method: 'POST' }
        ]
      },
      {
        id: `${prefix}_mod_ajs_comments`,
        title: 'Comments (评论管理)',
        routePath: '/admin/resources/Comment',
        level: 1,
        tableColumns: ['ID', 'PostID', 'User', 'Content', 'CreatedAt', 'Actions'],
        actions: [
          { id: `${prefix}_act_ajs_c_filter`, title: 'Filter Comments (筛选评论)', type: 'query', selector: isAi ? "role=button[name='Filter']" : "button:has-text('Filter')", method: 'GET' },
          { id: `${prefix}_act_ajs_c_new`, title: 'Add New Comment (新增评论)', type: 'create', selector: isAi ? "role=link[name='Create new']" : "a:has-text('Create new')", method: 'POST', formFields: ['postId', 'userId', 'content'] },
          { id: `${prefix}_act_ajs_c_show`, title: 'Show Comment Details (查看评论)', type: 'detail', selector: isAi ? "role=link[name='Show']" : "a:has-text('Show')", method: 'GET' },
          { id: `${prefix}_act_ajs_c_del`, title: 'Delete Comment (删除评论)', type: 'delete', selector: isAi ? "role=button[name='Delete']" : "button:has-text('Delete')", method: 'POST' }
        ]
      },
      {
        id: `${prefix}_mod_ajs_categories`,
        title: 'Categories (文章分类)',
        routePath: '/admin/resources/Category',
        level: 1,
        tableColumns: ['ID', 'Name', 'Slug', 'PostsCount', 'Actions'],
        actions: [
          { id: `${prefix}_act_ajs_cat_filter`, title: 'Filter Categories (检索分类)', type: 'query', selector: isAi ? "role=button[name='Filter']" : "button:has-text('Filter')", method: 'GET' },
          { id: `${prefix}_act_ajs_cat_new`, title: 'Create new Category (创建分类)', type: 'create', selector: isAi ? "role=link[name='Create new']" : "a:has-text('Create new')", method: 'POST', formFields: ['name', 'slug'] },
          { id: `${prefix}_act_ajs_cat_edit`, title: 'Edit Category (修改分类)', type: 'update', selector: isAi ? "role=link[name='Edit']" : "a:has-text('Edit')", method: 'POST' },
          { id: `${prefix}_act_ajs_cat_del`, title: 'Delete Category (删除分类)', type: 'delete', selector: isAi ? "role=button[name='Delete']" : "button:has-text('Delete')", method: 'POST' }
        ]
      },
      {
        id: `${prefix}_mod_ajs_companies`,
        title: 'Companies (企业租户)',
        routePath: '/admin/resources/Company',
        level: 1,
        tableColumns: ['ID', 'Company Name', 'Address', 'Employees', 'Actions'],
        actions: [
          { id: `${prefix}_act_ajs_comp_filter`, title: 'Filter Companies (检索企业)', type: 'query', selector: isAi ? "role=button[name='Filter']" : "button:has-text('Filter')", method: 'GET' },
          { id: `${prefix}_act_ajs_comp_new`, title: 'Create new Company (登记企业)', type: 'create', selector: isAi ? "role=link[name='Create new']" : "a:has-text('Create new')", method: 'POST', formFields: ['companyName', 'address'] },
          { id: `${prefix}_act_ajs_comp_show`, title: 'Show Company Profile (查看企业档案)', type: 'detail', selector: isAi ? "role=link[name='Show']" : "a:has-text('Show')", method: 'GET' },
          { id: `${prefix}_act_ajs_comp_edit`, title: 'Edit Company Info (编辑企业)', type: 'update', selector: isAi ? "role=link[name='Edit']" : "a:has-text('Edit')", method: 'POST' }
        ]
      },
      {
        id: `${prefix}_mod_ajs_profiles`,
        title: 'Profiles (个人档案)',
        routePath: '/admin/resources/Profile',
        level: 1,
        tableColumns: ['ID', 'Bio', 'Avatar', 'UserID', 'Actions'],
        actions: [
          { id: `${prefix}_act_ajs_prof_filter`, title: 'Filter Profiles (检索个人档案)', type: 'query', selector: isAi ? "role=button[name='Filter']" : "button:has-text('Filter')", method: 'GET' },
          { id: `${prefix}_act_ajs_prof_new`, title: 'Create new Profile (新建档案)', type: 'create', selector: isAi ? "role=link[name='Create new']" : "a:has-text('Create new')", method: 'POST', formFields: ['userId', 'bio', 'avatar'] },
          { id: `${prefix}_act_ajs_prof_view`, title: 'View Profile Details (查看个人档案)', type: 'detail', selector: isAi ? "role=link[name='Show']" : "a:has-text('Show')", method: 'GET' },
          { id: `${prefix}_act_ajs_prof_edit`, title: 'Edit Profile (修改档案)', type: 'update', selector: isAi ? "role=link[name='Edit']" : "a:has-text('Edit')", method: 'POST' }
        ]
      }
    ];
  }

  /**
   * 5. Django-Jazzmin 经典 Python 全量后台管理
   */
  static getDjangoJazzminTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_auth_sec`,
        title: 'Authentication and Authorization (权限与凭证)',
        routePath: '/admin/auth',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_dj_users`,
            title: 'Users (用户管理)',
            routePath: '/admin/auth/user/',
            level: 2,
            tableColumns: ['Username', 'Email address', 'First name', 'Last name', 'Staff status', 'Actions'],
            actions: [
              { id: `${prefix}_act_dj_u_search`, title: 'Search Users', type: 'query', selector: isAi ? "role=button[name='Search']" : "input[type='submit'][value='Search']", method: 'GET' },
              { id: `${prefix}_act_dj_u_add`, title: 'Add User', type: 'create', selector: isAi ? "role=link[name='Add user +']" : "a:has-text('Add user')", method: 'POST', formFields: ['username', 'password', 'password_confirmation'] },
              { id: `${prefix}_act_dj_u_change`, title: 'Change User Permissions & Groups', type: 'update', selector: isAi ? "role=link[name='Change']" : "a:has-text('Change')", method: 'POST' }
            ]
          },
          {
            id: `${prefix}_page_dj_groups`,
            title: 'Groups (角色组与权限策略)',
            routePath: '/admin/auth/group/',
            level: 2,
            tableColumns: ['Group name', 'Permissions count', 'Actions'],
            actions: [
              { id: `${prefix}_act_dj_g_add`, title: 'Add Group & Assign Permissions', type: 'create', selector: isAi ? "role=link[name='Add group +']" : "a:has-text('Add group')", method: 'POST', formFields: ['name', 'permissions'] }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 6. BeikeShop 官方电商中后台体系 (PHP + Laravel + Vue)
   */
  static getBeikeShopTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_shop_goods`,
        title: '商品管理 (Product Center)',
        routePath: '/admin/goods',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_beike_goods_list`,
            title: '商品列表 (Goods List)',
            routePath: '/admin/goods/index',
            level: 2,
            tableColumns: ['商品ID', '缩略图', '商品名称', '货号', '销售价', '库存', '上架状态', '操作'],
            actions: [
              { id: `${prefix}_act_beike_g_add`, title: '发布新商品', type: 'create', selector: isAi ? "role=button[name='新增商品']" : "button:has-text('新增')", method: 'POST', formFields: ['goods_name', 'category_id', 'price', 'stock'] },
              { id: `${prefix}_act_beike_g_query`, title: '搜索商品', type: 'query', selector: isAi ? "role=button[name='搜索']" : "button:has-text('搜索')", method: 'GET' },
              { id: `${prefix}_act_beike_g_del`, title: '下架与删除商品', type: 'delete', selector: isAi ? "role=button[name='删除']" : "button:has-text('删除')", method: 'POST' }
            ]
          },
          {
            id: `${prefix}_page_beike_category`,
            title: '商品分类 (Category Tree)',
            routePath: '/admin/goods/category',
            level: 2,
            tableColumns: ['分类ID', '分类名称', '层级', '排序', '状态', '操作'],
            actions: [
              { id: `${prefix}_act_beike_cat_add`, title: '添加商品分类', type: 'create', selector: isAi ? "role=button[name='添加分类']" : "button:has-text('添加')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_shop_orders`,
        title: '订单管理 (Order Center)',
        routePath: '/admin/order',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_beike_order_list`,
            title: '全部订单 (Orders)',
            routePath: '/admin/order/index',
            level: 2,
            tableColumns: ['订单编号', '买家', '总金额', '支付方式', '配送状态', '下单时间', '操作'],
            actions: [
              { id: `${prefix}_act_beike_ord_query`, title: '按状态筛选订单', type: 'query', selector: isAi ? "role=button[name='查询']" : "button:has-text('查询')", method: 'GET' },
              { id: `${prefix}_act_beike_ord_ship`, title: '订单发货与填写单号', type: 'update', selector: isAi ? "role=button[name='发货']" : "button:has-text('发货')", method: 'POST', formFields: ['express_no', 'express_company'] }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 7. Free-CRM 客户关系管理系统 (.NET / C# ASP)
   */
  static getFreeCrmTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_crm_core`,
        title: 'CRM 业务中心 (Customer Relationship)',
        routePath: '/crm',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_crm_leads`,
            title: 'Leads (潜在客户与线索)',
            routePath: '/crm/leads',
            level: 2,
            tableColumns: ['Lead ID', 'Full Name', 'Company', 'Phone', 'Lead Source', 'Status', 'Actions'],
            actions: [
              { id: `${prefix}_act_crm_l_add`, title: 'Create New Lead', type: 'create', selector: isAi ? "role=button[name='New Lead'], .btn-new" : "button:has-text('New Lead')", method: 'POST', formFields: ['firstName', 'lastName', 'company', 'email', 'phone'] },
              { id: `${prefix}_act_crm_l_search`, title: 'Search & Filter Leads', type: 'query', selector: isAi ? "role=button[name='Search']" : "button:has-text('Search')", method: 'GET' }
            ]
          },
          {
            id: `${prefix}_page_crm_deals`,
            title: 'Deals & Pipeline (商机与交易漏斗)',
            routePath: '/crm/deals',
            level: 2,
            tableColumns: ['Deal Name', 'Stage', 'Amount ($)', 'Probability', 'Closing Date', 'Actions'],
            actions: [
              { id: `${prefix}_act_crm_d_create`, title: 'Create Opportunity Deal', type: 'create', selector: isAi ? "role=button[name='Add Deal']" : "button:has-text('Add Deal')", method: 'POST', formFields: ['dealName', 'amount', 'stage', 'closingDate'] }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 8. LaraDashboard 现代化后台 (Laravel + Livewire / Inertia)
   */
  static getLaraDashboardTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_lara_main`,
        title: 'LaraDashboard 管理中枢',
        routePath: '/dashboard',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_lara_analytics`,
            title: '数据统计与分析 (Analytics Overview)',
            routePath: '/dashboard/analytics',
            level: 2,
            tableColumns: ['Metric', 'Current Value', 'Change Rate', 'Trend', 'Actions'],
            actions: [
              { id: `${prefix}_act_lara_refresh`, title: 'Refresh Analytics Metrics', type: 'query', selector: isAi ? "role=button[name='Refresh']" : "button:has-text('Refresh')", method: 'GET' }
            ]
          },
          {
            id: `${prefix}_page_lara_users`,
            title: '用户与租户管理 (Users & Tenants)',
            routePath: '/dashboard/users',
            level: 2,
            tableColumns: ['ID', 'Name', 'Email', 'Role', 'Status', 'Registered At', 'Actions'],
            actions: [
              { id: `${prefix}_act_lara_u_create`, title: 'Invite / Add User', type: 'create', selector: isAi ? "role=button[name='Add User']" : "button:has-text('Add User')", method: 'POST', formFields: ['name', 'email', 'role'] },
              { id: `${prefix}_act_lara_u_edit`, title: 'Edit User Info & Access', type: 'update', selector: isAi ? "role=button[name='Edit']" : "a:has-text('Edit')", method: 'POST' },
              { id: `${prefix}_act_lara_u_del`, title: 'Suspend / Delete User', type: 'delete', selector: isAi ? "role=button[name='Delete']" : "button:has-text('Delete')", method: 'DELETE' }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 9. BadouCMS 经典内容发布管理系统 (PHP / ThinkPHP)
   * 严格对应官方后台 6 个一级模块与 9 个真实管理页面
   */
  static getBadouCmsTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_cms_content`,
        title: '内容管理 (Content)',
        routePath: '/admin.php/content',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_cms_articles`,
            title: '文章资讯列表 (Articles)',
            routePath: '/admin.php/article/index',
            level: 2,
            tableColumns: ['ID', '文章标题', '所属栏目', '作者', '点击量', '发布时间', '操作'],
            actions: [
              { id: `${prefix}_act_cms_art_add`, title: '发布新文章', type: 'create', selector: isAi ? "role=button[name='发布文章'], .btn-add" : "button:has-text('发布')", method: 'POST', formFields: ['title', 'catid', 'content', 'keywords'] },
              { id: `${prefix}_act_cms_art_edit`, title: '编辑修改文章', type: 'update', selector: isAi ? "role=button[name='编辑']" : "a:has-text('编辑')", method: 'POST' },
              { id: `${prefix}_act_cms_art_del`, title: '删除文章', type: 'delete', selector: isAi ? "role=button[name='删除']" : "a:has-text('删除')", method: 'POST' }
            ]
          },
          {
            id: `${prefix}_page_cms_columns`,
            title: '栏目与分类管理 (Columns)',
            routePath: '/admin.php/category/index',
            level: 2,
            tableColumns: ['栏目ID', '栏目名称', '英文标识', '排序', '状态', '操作'],
            actions: [
              { id: `${prefix}_act_cms_col_add`, title: '新增网站栏目', type: 'create', selector: isAi ? "role=button[name='新增栏目']" : "button:has-text('新增')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_cms_model`,
        title: '模型管理 (Data Models)',
        routePath: '/admin.php/model',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_cms_models`,
            title: '自定义模型列表 (Model List)',
            routePath: '/admin.php/model/index',
            level: 2,
            tableColumns: ['模型ID', '模型名称', '附加表名', '状态', '操作'],
            actions: [
              { id: `${prefix}_act_cms_m_add`, title: '创建新内容模型', type: 'create', selector: isAi ? "role=button[name='添加模型']" : "button:has-text('添加')", method: 'POST', formFields: ['name', 'tablename'] }
            ]
          },
          {
            id: `${prefix}_page_cms_fields`,
            title: '字段管理 (Field Config)',
            routePath: '/admin.php/field/index',
            level: 2,
            tableColumns: ['字段标识', '字段别名', '输入表单类型', '必填', '操作'],
            actions: [
              { id: `${prefix}_act_cms_f_add`, title: '新增模型字段', type: 'create', selector: isAi ? "role=button[name='添加字段']" : "button:has-text('添加')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_cms_member`,
        title: '会员与用户管理 (Members)',
        routePath: '/admin.php/member',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_cms_users`,
            title: '会员列表 (Member Users)',
            routePath: '/admin.php/member/index',
            level: 2,
            tableColumns: ['UID', '用户名', '邮箱', '积分', '注册时间', '操作'],
            actions: [
              { id: `${prefix}_act_cms_u_filter`, title: '查询与筛选会员', type: 'query', selector: isAi ? "role=button[name='搜索']" : "button:has-text('搜索')", method: 'GET' }
            ]
          },
          {
            id: `${prefix}_page_cms_groups`,
            title: '会员组与权限 (Member Groups)',
            routePath: '/admin.php/group/index',
            level: 2,
            tableColumns: ['组ID', '组名称', '折扣率', '升级积分', '操作'],
            actions: [
              { id: `${prefix}_act_cms_g_add`, title: '新增会员等级', type: 'create', selector: isAi ? "role=button[name='添加组']" : "button:has-text('添加')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_cms_system`,
        title: '系统设置 (System Settings)',
        routePath: '/admin.php/system',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_cms_config`,
            title: '站点基础配置 (Site Config)',
            routePath: '/admin.php/config/index',
            level: 2,
            actions: [
              { id: `${prefix}_act_cms_cfg_save`, title: '保存站点名称与 SEO 参数', type: 'update', selector: isAi ? "role=button[name='保存配置']" : "button:has-text('保存')", method: 'POST', formFields: ['sitename', 'keywords', 'description'] }
            ]
          },
          {
            id: `${prefix}_page_cms_admin_users`,
            title: '后台管理员 (Admin Users)',
            routePath: '/admin.php/admin/index',
            level: 2,
            tableColumns: ['ID', '管理员帐号', '最后登录IP', '登录次数', '操作'],
            actions: [
              { id: `${prefix}_act_cms_adm_add`, title: '创建后台管理员', type: 'create', selector: isAi ? "role=button[name='添加管理员']" : "button:has-text('添加')", method: 'POST', formFields: ['username', 'password'] }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_cms_extend`,
        title: '扩展插件 (Plugins & Extend)',
        routePath: '/admin.php/extend',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_cms_plugins`,
            title: '插件列表与配置 (Plugins)',
            routePath: '/admin.php/plugin/index',
            level: 2,
            tableColumns: ['插件标识', '插件名称', '作者', '版本', '启用状态', '操作'],
            actions: [
              { id: `${prefix}_act_cms_plug_install`, title: '安装与启用插件', type: 'create', selector: isAi ? "role=button[name='安装']" : "a:has-text('安装')", method: 'POST' }
            ]
          }
        ]
      },
      {
        id: `${prefix}_mod_cms_tools`,
        title: '维护与工具 (Maintenance & Tools)',
        routePath: '/admin.php/tools',
        level: 1,
        actions: [
          { id: `${prefix}_act_cms_cache_clear`, title: '一键清理全站运行时缓存', type: 'delete', selector: isAi ? "role=button[name='清除缓存']" : "a:has-text('清除缓存')", method: 'POST' }
        ]
      }
    ];
  }

  /**
   * 10. Scoriet Dev 开发者运维与审计平台
   */
  static getScorietDevTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_scoriet_core`,
        title: 'Scoriet 运维与审计中心',
        routePath: '/admin',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_scoriet_logs`,
            title: '日志审计与追踪 (Audit Logs)',
            routePath: '/admin/logs',
            level: 2,
            tableColumns: ['Log ID', 'Service', 'Level', 'Message', 'Timestamp', 'Actions'],
            actions: [
              { id: `${prefix}_act_scoriet_log_query`, title: 'Search & Stream Logs', type: 'query', selector: isAi ? "role=button[name='Search']" : "button:has-text('Search')", method: 'GET' }
            ]
          },
          {
            id: `${prefix}_page_scoriet_instances`,
            title: '服务实例监控 (Instances)',
            routePath: '/admin/instances',
            level: 2,
            tableColumns: ['Instance ID', 'Host', 'Port', 'CPU %', 'Memory %', 'Status', 'Actions'],
            actions: [
              { id: `${prefix}_act_scoriet_restart`, title: 'Restart Remote Instance', type: 'update', selector: isAi ? "role=button[name='Restart']" : "button:has-text('Restart')", method: 'POST' }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 11. Employee Attendance 员工考勤与排班系统
   */
  static getEmployeeAttendanceTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_mod_att_core`,
        title: '考勤与人事管理 (Attendance & HR)',
        routePath: '/attendance',
        level: 1,
        actions: [],
        children: [
          {
            id: `${prefix}_page_att_records`,
            title: '打卡记录与明细 (Punch Records)',
            routePath: '/attendance/records',
            level: 2,
            tableColumns: ['员工工号', '姓名', '部门', '打卡时间', '打卡地点', '考勤状态', '操作'],
            actions: [
              { id: `${prefix}_act_att_query`, title: '按月查询考勤明细', type: 'query', selector: isAi ? "role=button[name='查询']" : "button:has-text('查询')", method: 'GET' },
              { id: `${prefix}_act_att_export`, title: '导出考勤月报表 Excel', type: 'export', selector: isAi ? "role=button[name='导出']" : "button:has-text('导出')", method: 'POST' }
            ]
          },
          {
            id: `${prefix}_page_att_leaves`,
            title: '请假与出差审批 (Leave Requests)',
            routePath: '/attendance/leaves',
            level: 2,
            tableColumns: ['请假单号', '申请人', '请假类型', '开始时间', '结束时间', '审批状态', '操作'],
            actions: [
              { id: `${prefix}_act_leave_apply`, title: '提交请假申请', type: 'create', selector: isAi ? "role=button[name='申请请假']" : "button:has-text('申请')", method: 'POST', formFields: ['leaveType', 'startTime', 'endTime', 'reason'] },
              { id: `${prefix}_act_leave_approve`, title: '审批通过/驳回', type: 'auth', selector: isAi ? "role=button[name='审批']" : "button:has-text('审批')", method: 'PUT' }
            ]
          }
        ]
      }
    ];
  }

  /**
   * 12. Angular-DRF-Admin (Angular + Django REST Framework)
   * 严格对应用户实测 7 个父级实体与管理菜单
   */
  static getAngularDrfTree(prefix: string, isAi: boolean): PageNodeDescriptor[] {
    return [
      {
        id: `${prefix}_drf_dashboard`,
        title: 'Dashboard (仪表盘)',
        routePath: '/dashboard',
        level: 1,
        actions: [{ id: `${prefix}_act_drf_dash`, title: 'Refresh Overview', type: 'query', selector: isAi ? "role=button[name='Refresh']" : "button:has-text('Refresh')", method: 'GET' }]
      },
      {
        id: `${prefix}_drf_users`,
        title: 'Users (用户管理)',
        routePath: '/users',
        level: 1,
        tableColumns: ['ID', 'Username', 'Email', 'Is Active', 'Is Staff', 'Actions'],
        actions: [
          { id: `${prefix}_act_drf_u_add`, title: 'Add User', type: 'create', selector: isAi ? "role=button[name='Add User']" : "button:has-text('Add User')", method: 'POST', formFields: ['username', 'email', 'password'] },
          { id: `${prefix}_act_drf_u_query`, title: 'Filter Users', type: 'query', selector: isAi ? "role=button[name='Search']" : "button:has-text('Search')", method: 'GET' }
        ]
      },
      {
        id: `${prefix}_drf_groups`,
        title: 'Groups (角色用户组)',
        routePath: '/groups',
        level: 1,
        tableColumns: ['ID', 'Name', 'Permissions', 'Actions'],
        actions: [
          { id: `${prefix}_act_drf_g_add`, title: 'Add Group', type: 'create', selector: isAi ? "role=button[name='Add Group']" : "button:has-text('Add Group')", method: 'POST', formFields: ['name'] }
        ]
      },
      {
        id: `${prefix}_drf_permissions`,
        title: 'Permissions (权限字典)',
        routePath: '/permissions',
        level: 1,
        tableColumns: ['ID', 'Name', 'Codename', 'Content Type', 'Actions'],
        actions: [
          { id: `${prefix}_act_drf_perm_query`, title: 'Query Permissions', type: 'query', selector: isAi ? "role=button[name='Search']" : "button:has-text('Search')", method: 'GET' }
        ]
      },
      {
        id: `${prefix}_drf_articles`,
        title: 'Articles (文章内容)',
        routePath: '/articles',
        level: 1,
        tableColumns: ['ID', 'Title', 'Author', 'Created', 'Actions'],
        actions: [
          { id: `${prefix}_act_drf_art_add`, title: 'Create Article', type: 'create', selector: isAi ? "role=button[name='New Article']" : "button:has-text('New')", method: 'POST', formFields: ['title', 'body'] }
        ]
      },
      {
        id: `${prefix}_drf_tags`,
        title: 'Tags (标签分类)',
        routePath: '/tags',
        level: 1,
        tableColumns: ['ID', 'Tag Name', 'Usage Count', 'Actions'],
        actions: [
          { id: `${prefix}_act_drf_tag_add`, title: 'Add Tag', type: 'create', selector: isAi ? "role=button[name='Add Tag']" : "button:has-text('Add Tag')", method: 'POST', formFields: ['name'] }
        ]
      },
      {
        id: `${prefix}_drf_settings`,
        title: 'System Settings (系统配置)',
        routePath: '/settings',
        level: 1,
        actions: [
          { id: `${prefix}_act_drf_set_save`, title: 'Save API Settings', type: 'update', selector: isAi ? "role=button[name='Save']" : "button:has-text('Save')", method: 'POST', formFields: ['api_url', 'page_size'] }
        ]
      }
    ];
  }
}
