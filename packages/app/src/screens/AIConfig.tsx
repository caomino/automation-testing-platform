import { useState, useEffect } from "react";
import { Button, Card, Table, Tag, Modal, ConfirmDialog } from "../components";
import { useApp } from "../context";
import type { AiConfigView } from "../context";
import type { VendorInfo, TestConnectionResultApi } from "../services/dataApi";

const LOCAL_VENDOR_PRESETS: VendorInfo[] = [
  { vendor: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'], description: '原生 OpenAI API' },
  { vendor: 'azure', label: 'Azure OpenAI', baseUrl: 'https://{resource}.openai.azure.com', models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'], description: 'Azure OpenAI Service' },
  { vendor: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-sonnet'], description: 'Anthropic Claude API' },
  { vendor: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', models: ['gemini-1.5-pro', 'gemini-1.5-flash'], description: 'Google Gemini API' },
  { vendor: 'deepseek', label: 'Deepseek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], description: 'Deepseek AI API' },
  { vendor: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo'], description: '阿里巴巴通义千问' },
  { vendor: 'zhipu', label: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'], description: '智谱 AI 开放平台' },
  { vendor: 'minimax', label: 'MiniMax (海螺AI)', baseUrl: 'https://api.minimax.chat/v1', models: ['MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5t-chat', 'abab6.5-chat', 'abab5.5-chat'], description: 'MiniMax 开放平台 (兼容 OpenAI 协议)' },
  { vendor: 'moonshot', label: '月之暗面 (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], description: 'Moonshot AI 开放平台' },
  { vendor: 'baichuan', label: '百川智能', baseUrl: 'https://api.baichuan-ai.com/v1', models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan2-Turbo'], description: '百川大模型 API' },
  { vendor: 'yi', label: '零一万物 (Yi)', baseUrl: 'https://api.lingyiwanwu.com/v1', models: ['yi-large', 'yi-medium', 'yi-spark'], description: '零一万物大模型开放平台' },
  { vendor: 'custom', label: '自定义/中转', baseUrl: '', models: [], description: '兼容 OpenAI 协议的任意端点' },
];

export function AIConfig() {
  const {
    aiConfigs, aiAdd, aiUpdate, aiRemove, aiToggleEnabled, aiSetDefault,
    aiListVendors, aiGetVendorModels, aiFetchRemoteModels, aiTestConnection, toast
  } = useApp();

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResultApi | null>(null);
  const [newConfig, setNewConfig] = useState<Partial<AiConfigView> & { apiKey?: string }>({});
  const [editConfig, setEditConfig] = useState<(AiConfigView & { apiKey?: string }) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string } | null>(null);
  const [vendors, setVendors] = useState<VendorInfo[]>(LOCAL_VENDOR_PRESETS);
  const [presetModels, setPresetModels] = useState<string[]>([]);
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    aiListVendors().then((remote) => {
      if (remote.length > 0) {
        setVendors(remote);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const vendor = newConfig.vendor;
    if (vendor) {
      aiGetVendorModels(vendor).then((r) => {
        setPresetModels(r.models);
        if ((!newConfig.baseUrl || newConfig.baseUrl === '') && r.baseUrl) {
          setNewConfig((prev) => ({ ...prev, baseUrl: r.baseUrl }));
        }
      }).catch(() => {
        const local = LOCAL_VENDOR_PRESETS.find((v) => v.vendor === vendor);
        setPresetModels(local?.models ?? []);
        if ((!newConfig.baseUrl || newConfig.baseUrl === '') && local?.baseUrl) {
          setNewConfig((prev) => ({ ...prev, baseUrl: local.baseUrl }));
        }
      });
    } else {
      setPresetModels([]);
    }
  }, [newConfig.vendor]);

  useEffect(() => {
    if (editConfig?.vendor) {
      aiGetVendorModels(editConfig.vendor).then((r) => {
        setPresetModels((prev) => {
          const merged = [...new Set([...prev, ...r.models])];
          return merged;
        });
      });
    }
  }, [editConfig?.vendor]);

  const fetchRemoteModelsForForm = async () => {
    if (!newConfig.baseUrl || !newConfig.apiKey) {
      toast("请先填写 Base URL 和 API Key");
      return;
    }
    const result = await aiFetchRemoteModels(newConfig.baseUrl, newConfig.apiKey);
    setRemoteModels(result.models);
    toast(result.message);
  };

  const handleAdd = async () => {
    const modelValue = newConfig.model === '__custom__' ? '' : (newConfig.model ?? '');
    if (!newConfig.name || !modelValue) {
      toast("请填写配置名称和模型");
      return;
    }
    if (!newConfig.baseUrl) {
      toast("请填写 Base URL");
      return;
    }
    await aiAdd({
      name: newConfig.name,
      vendor: newConfig.vendor ?? "",
      baseUrl: newConfig.baseUrl,
      model: modelValue,
      apiKey: newConfig.apiKey,
      enabled: newConfig.enabled ?? true,
      isDefault: newConfig.isDefault ?? false,
      temperature: newConfig.temperature,
      maxTokens: newConfig.maxTokens,
    });
    setAddOpen(false);
    setNewConfig({});
    setPresetModels([]);
    setRemoteModels([]);
  };

  const handleEdit = async () => {
    if (!editConfig) return;
    await aiUpdate(editConfig.id, {
      name: editConfig.name,
      vendor: editConfig.vendor,
      baseUrl: editConfig.baseUrl,
      model: editConfig.model,
      apiKey: editConfig.apiKey,
      enabled: editConfig.enabled,
      isDefault: editConfig.isDefault,
      temperature: editConfig.temperature,
      maxTokens: editConfig.maxTokens,
    });
    setEditOpen(false);
    setEditConfig(null);
  };

  const handleTest = async (config: AiConfigView) => {
    setTesting(true);
    const result = await aiTestConnection({
      configId: config.id,
      baseUrl: config.baseUrl,
      model: config.model,
    });
    setTestResult(result);
    setTesting(false);
  };

  const handleTestFromForm = async () => {
    if (!newConfig.baseUrl || !newConfig.model) {
      toast("请填写 Base URL 和模型");
      return;
    }
    setTesting(true);
    const result = await aiTestConnection({
      baseUrl: newConfig.baseUrl,
      model: newConfig.model,
      apiKey: newConfig.apiKey,
    });
    setTestResult(result);
    setTesting(false);
  };

  const allModels = [...new Set([...presetModels, ...remoteModels])];
  const vendorOptions = [
    { value: '', label: '— 不指定厂商（中转/代理） —' },
    ...vendors.map((v) => ({ value: v.vendor, label: `${v.label}${v.baseUrl ? ` (${v.baseUrl})` : ''}` })),
  ];

  return (
    <>
      <div className="ph">
        <div>
          <h2>⑦ AI 模型配置</h2>
          <div className="sub">增删改查 + 启用/默认 + 测试连接</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={() => setAddOpen(true)}>
            + 添加配置
          </Button>
        </div>
      </div>

      <Card title={`AI 配置列表（${aiConfigs.length} 项）`}>
        <Table
          columns={[
            { key: "name", title: "名称", width: 120 },
            { key: "vendor", title: "厂商", width: 100, render: (r: any) => r.vendor || <span style={{ color: "var(--mut)" }}>未指定</span> },
            { key: "baseUrl", title: "Base URL", mono: true, width: 200 },
            { key: "model", title: "模型", width: 150 },
            {
              key: "enabled",
              title: "启用",
              width: 80,
              render: (r: any) => (
                <Button
                  size="sm"
                  variant={r.enabled ? "pri" : "ghost"}
                  onClick={() => aiToggleEnabled(r.id)}
                >
                  {r.enabled ? "✓ 启用" : "○ 禁用"}
                </Button>
              ),
            },
            {
              key: "isDefault",
              title: "默认",
              width: 60,
              render: (r: any) => r.isDefault ? <Tag tone="info">默认</Tag> : <span style={{ color: "var(--mut)" }}>—</span>,
            },
            {
              key: "operations",
              title: "操作",
              width: 280,
              render: (r: any) => (
                <div className="op">
                  <Button size="sm" onClick={() => handleTest(r)} disabled={testing}>
                    测试
                  </Button>
                  <Button size="sm" onClick={() => aiSetDefault(r.id)} disabled={r.isDefault}>
                    设为默认
                  </Button>
                  <Button size="sm" onClick={() => { setEditConfig(r); setEditOpen(true); }}>
                    编辑
                  </Button>
                  <Button size="sm" variant="dng" onClick={() => setConfirmDelete({ open: true, id: r.id })}>
                    删除
                  </Button>
                </div>
              ),
            },
          ]}
          rows={aiConfigs as any[]}
          rowKey={(r: any) => r.id}
        />
      </Card>

      <Modal
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setNewConfig({});
          setPresetModels([]);
          setRemoteModels([]);
        }}
        title="+ 添加 AI 配置"
        footer={
          <>
            <Button onClick={handleTestFromForm} disabled={!newConfig.baseUrl || !newConfig.model}>测试连接</Button>
            <Button onClick={() => { setAddOpen(false); setNewConfig({}); }}>取消</Button>
            <Button variant="pri" onClick={handleAdd}>创建</Button>
          </>
        }
      >
        <div className="field">
          <label>配置名称 *</label>
          <input className="text-input" placeholder="如：工作助手-GPT4o" value={newConfig.name ?? ""} onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })} />
        </div>

        <div className="field">
          <label>AI 厂商</label>
          <select className="text-input" value={newConfig.vendor ?? ""} onChange={(e) => setNewConfig({ ...newConfig, vendor: e.target.value })}>
            {vendorOptions.map((v) => (
              <option key={v.value || 'none'} value={v.value}>{v.label}</option>
            ))}
          </select>
          <div className="hint">选择厂商后自动填充 Base URL 和预设模型；中转代理场景可选"不指定厂商"</div>
        </div>

        <div className="field">
          <label>Base URL *</label>
          <input className="text-input" placeholder="https://api.example.com/v1" value={newConfig.baseUrl ?? ""} onChange={(e) => setNewConfig({ ...newConfig, baseUrl: e.target.value })} />
          {newConfig.vendor && presetModels.length > 0 && (
            <div className="hint">已自动填充所选厂商的默认地址，可自定义修改</div>
          )}
        </div>

        <div className="field">
          <label>API Key</label>
          <input className="text-input" type="password" placeholder="sk-xxxxxxxxxxxxxxxx" value={newConfig.apiKey ?? ""} onChange={(e) => setNewConfig({ ...newConfig, apiKey: e.target.value })} />
          <div className="hint">密钥将使用 AES-256-GCM 加密存储，仅以引用 ID 关联</div>
        </div>

        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <label>模型 *</label>
            <Button size="sm" variant="ghost" onClick={fetchRemoteModelsForForm} disabled={!newConfig.baseUrl || !newConfig.apiKey}>
              从远程获取
            </Button>
          </div>
          {presetModels.length > 0 && !newConfig.model ? (
            <select
              className="text-input"
              value=""
              onChange={(e) => setNewConfig({ ...newConfig, model: e.target.value })}
            >
              <option value="">— 选择预设模型 —</option>
              {allModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
              <option value="__custom__">自定义输入...</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="text-input"
                placeholder="输入模型名称"
                value={newConfig.model === '__custom__' ? '' : (newConfig.model ?? '')}
                onChange={(e) => setNewConfig({ ...newConfig, model: e.target.value })}
                style={{ flex: 1 }}
              />
              {allModels.length > 0 && (
                <select
                  className="text-input"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) setNewConfig({ ...newConfig, model: e.target.value });
                  }}
                  style={{ width: 140 }}
                >
                  <option value="">预设</option>
                  {allModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
            </div>
          )}
          {remoteModels.length > 0 && (
            <div className="hint">远程发现 {remoteModels.length} 个模型</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>温度</label>
            <input className="text-input" type="number" min={0} max={2} step={0.1} value={newConfig.temperature ?? 0.7} onChange={(e) => setNewConfig({ ...newConfig, temperature: parseFloat(e.target.value) || 0.7 })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>最大 Token</label>
            <input className="text-input" type="number" min={1} placeholder="默认" value={newConfig.maxTokens ?? ""} onChange={(e) => setNewConfig({ ...newConfig, maxTokens: e.target.value ? parseInt(e.target.value) : undefined })} />
          </div>
        </div>

        <div className="field" style={{ display: 'flex', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={newConfig.enabled ?? true} onChange={(e) => setNewConfig({ ...newConfig, enabled: e.target.checked })} />
            创建后立即启用
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={newConfig.isDefault ?? false} onChange={(e) => setNewConfig({ ...newConfig, isDefault: e.target.checked })} />
            设为默认配置
          </label>
        </div>
      </Modal>

      <Modal
        open={editOpen}
        onClose={() => { setEditOpen(false); setEditConfig(null); }}
        title="编辑 AI 配置"
        footer={
          <>
            <Button onClick={() => { setEditOpen(false); setEditConfig(null); }}>取消</Button>
            <Button variant="pri" onClick={handleEdit}>保存</Button>
          </>
        }
      >
        {editConfig && (
          <>
            <div className="field">
              <label>配置名称</label>
              <input className="text-input" value={editConfig.name} onChange={(e) => setEditConfig({ ...editConfig, name: e.target.value })} />
            </div>
            <div className="field">
              <label>AI 厂商</label>
              <select className="text-input" value={editConfig.vendor ?? ""} onChange={(e) => setEditConfig({ ...editConfig, vendor: e.target.value })}>
                {vendorOptions.map((v) => (
                  <option key={v.value || 'none'} value={v.value}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Base URL</label>
              <input className="text-input" value={editConfig.baseUrl} onChange={(e) => setEditConfig({ ...editConfig, baseUrl: e.target.value })} />
            </div>
            <div className="field">
              <label>API Key</label>
              <input className="text-input" type="password" placeholder="留空则不更新密钥" value={editConfig.apiKey ?? ""} onChange={(e) => setEditConfig({ ...editConfig, apiKey: e.target.value })} />
              {editConfig.apiKeyRef && <div className="hint">当前密钥引用: {editConfig.apiKeyRef.slice(0, 12)}...</div>}
            </div>
            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label>模型</label>
                {editConfig.vendor && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    const r = await aiGetVendorModels(editConfig.vendor);
                    const models = r.models;
                    if (models.length > 0) {
                      const idx = models.findIndex((m: string) => m === editConfig.model);
                      if (idx === -1 && models.length > 0) {
                        setEditConfig({ ...editConfig, model: models[0] });
                      }
                    }
                  }}>获取预设</Button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="text-input" placeholder="输入或选择模型" value={editConfig.model} onChange={(e) => setEditConfig({ ...editConfig, model: e.target.value })} style={{ flex: 1 }} />
                {presetModels.length > 0 && (
                  <select
                    className="text-input"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setEditConfig({ ...editConfig, model: e.target.value });
                    }}
                    style={{ width: 140 }}
                  >
                    <option value="">预设</option>
                    {presetModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>温度</label>
                <input className="text-input" type="number" min={0} max={2} step={0.1} value={editConfig.temperature ?? 0.7} onChange={(e) => setEditConfig({ ...editConfig, temperature: parseFloat(e.target.value) || 0.7 })} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>最大 Token</label>
                <input className="text-input" type="number" min={1} placeholder="默认" value={editConfig.maxTokens ?? ""} onChange={(e) => setEditConfig({ ...editConfig, maxTokens: e.target.value ? parseInt(e.target.value) : undefined })} />
              </div>
            </div>
            <div className="field" style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={editConfig.enabled} onChange={(e) => setEditConfig({ ...editConfig, enabled: e.target.checked })} />
                启用
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={editConfig.isDefault} onChange={(e) => setEditConfig({ ...editConfig, isDefault: e.target.checked })} />
                设为默认
              </label>
            </div>
          </>
        )}
      </Modal>

      {testResult && (
        <Modal open onClose={() => setTestResult(null)} title="连接测试结果">
          <div style={{ textAlign: "center", padding: 20 }}>
            {testResult.success ? (
              <Tag tone="ok">✓ 连接成功 ({testResult.latencyMs}ms)</Tag>
            ) : (
              <Tag tone="danger">✗ 连接失败 (HTTP {testResult.status})</Tag>
            )}
            <div className="hint" style={{ marginTop: 8 }}>
              {testResult.message}
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={confirmDelete?.open ?? false}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && aiRemove(confirmDelete.id)}
        title="删除确认"
        message="确定要删除此 AI 配置吗？此操作不可恢复。"
        danger
      />
    </>
  );
}