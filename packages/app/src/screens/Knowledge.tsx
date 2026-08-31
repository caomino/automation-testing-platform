import { useState } from "react";
import { Button, Card, Tag } from "../components";
import { useApp } from "../context";
import type { KnowledgeEntry } from "../context";

interface TreeNode {
  id: string;
  label: string;
  scope: "project" | "system";
  projectId: string;
  systemId?: string;
  children?: TreeNode[];
  hasKnowledge: boolean;
}

export function Knowledge() {
  const { projects, systems, knowledge, addKnowledge, updateKnowledge, toast } = useApp();

  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [editContent, setEditContent] = useState("");

  // 构建树形结构
  const tree: TreeNode[] = projects.map((p) => {
    const projSystems = systems.filter((s) => s.projectId === p.id);
    const projKb = knowledge.find((k) => k.projectId === p.id && !k.systemId);
    return {
      id: p.id,
      label: p.name,
      scope: "project",
      projectId: p.id,
      hasKnowledge: !!projKb,
      children: projSystems.map((s) => {
        const sysKb = knowledge.find((k) => k.projectId === p.id && k.systemId === s.id);
        return {
          id: s.id,
          label: s.name,
          scope: "system",
          projectId: p.id,
          systemId: s.id,
          hasKnowledge: !!sysKb,
        };
      }),
    };
  });

  const handleSelectNode = (node: TreeNode) => {
    setSelectedNode(node);
    const existing = knowledge.find(
      (k) =>
        k.projectId === node.projectId &&
        (node.scope === "project" ? !k.systemId : k.systemId === node.systemId)
    );
    setEditContent(existing?.content ?? "");
  };

  const handleSave = async () => {
    if (!selectedNode) {
      toast("请先选择一个项目或系统");
      return;
    }
    if (!editContent.trim()) {
      toast("请输入指令内容");
      return;
    }

    const existingId = knowledge.find(
      (k) =>
        k.projectId === selectedNode.projectId &&
        (selectedNode.scope === "project" ? !k.systemId : k.systemId === selectedNode.systemId)
    )?.id;

    if (existingId) {
      await updateKnowledge(existingId, editContent);
    } else {
      const id = `kb-${selectedNode.projectId}${selectedNode.systemId ? `-${selectedNode.systemId}` : ""}`;
      const entry: KnowledgeEntry = {
        id,
        scope: selectedNode.scope,
        projectId: selectedNode.projectId,
        systemId: selectedNode.systemId,
        content: editContent,
      };
      await addKnowledge(entry);
    }
  };

  const handleReset = () => {
    if (!selectedNode) return;
    const existing = knowledge.find(
      (k) =>
        k.projectId === selectedNode.projectId &&
        (selectedNode.scope === "project" ? !k.systemId : k.systemId === selectedNode.systemId)
    );
    setEditContent(existing?.content ?? "");
    toast("已重置");
  };

  const renderTree = (nodes: TreeNode[], level = 0) => {
    return (
      <ul style={{ paddingLeft: level > 0 ? 20 : 0 }}>
        {nodes.map((node) => (
          <li key={node.id}>
            <div
              className={`node ${selectedNode?.id === node.id ? "sel" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => handleSelectNode(node)}
            >
              <span>
                {node.scope === "project" ? "📁" : "🔧"} {node.label}
              </span>
              <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {node.hasKnowledge ? (
                  <Tag tone="ok" style={{ fontSize: 10 }}>✓ 已配置</Tag>
                ) : (
                  <Tag tone="gray" style={{ fontSize: 10 }}>+ 待配置</Tag>
                )}
                {node.scope === "project" && (
                  <Tag tone="info" style={{ fontSize: 10 }}>项目</Tag>
                )}
                {node.scope === "system" && (
                  <Tag tone="gray" style={{ fontSize: 10 }}>系统</Tag>
                )}
              </span>
            </div>
            {node.children && node.children.length > 0 && renderTree(node.children, level + 1)}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <>
      <div className="ph">
        <div>
          <h2>⑩ 知识库</h2>
          <div className="sub">项目级 + 系统级指令配置 · 与 AI 生成联动</div>
        </div>
        <div className="row">
          <Button variant="pri" onClick={handleSave} disabled={!selectedNode}>
            💾 保存
          </Button>
          <Button onClick={handleReset} disabled={!selectedNode}>↺ 重置</Button>
        </div>
      </div>

      <div className="grid g2">
        <Card title="知识范围（项目 / 系统）">
          <div className="tree">
            <div className="root">📚 知识库</div>
            {tree.length > 0 ? (
              renderTree(tree)
            ) : (
              <div className="hint" style={{ padding: "12px", color: "var(--mut)" }}>
                暂无项目，请先在"项目管理"中创建
              </div>
            )}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            选择项目或系统后，在右侧编辑 AI 指令。指令将用于该范围内所有 AI 生成任务的提示词注入。
          </div>
        </Card>

        <Card title={selectedNode ? `编辑 · ${selectedNode.label}` : "编辑区"}>
          {selectedNode ? (
            <>
              <div className="field">
                <label>
                  作用域：
                  {selectedNode.scope === "project" ? (
                    <Tag tone="info" style={{ marginLeft: 8 }}>项目级</Tag>
                  ) : (
                    <Tag tone="gray" style={{ marginLeft: 8 }}>系统级</Tag>
                  )}
                </label>
              </div>
              <div className="field">
                <label>AI 指令内容</label>
                <textarea
                  className="text-area"
                  rows={15}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="在此编辑 AI 指令内容，该指令将作为 Prompt 注入影响用例生成、缺陷分析等输出..."
                  style={{ width: "100%", minHeight: 300, fontFamily: "monospace", fontSize: 13 }}
                />
              </div>
              <div className="row">
                <Button variant="pri" onClick={handleSave}>保存</Button>
                <Button onClick={handleReset}>重置</Button>
              </div>
              <div className="hint" style={{ marginTop: 8 }}>
                <b>使用说明：</b>
                此内容将作为 AI 提示词注入，影响用例生成、缺陷分析等功能的输出质量。系统级指令会覆盖项目级指令。
              </div>
            </>
          ) : (
            <div className="hint" style={{ padding: "40px", textAlign: "center", color: "var(--mut)" }}>
              请在左侧选择一个项目或系统开始配置
            </div>
          )}
        </Card>
      </div>
    </>
  );
}