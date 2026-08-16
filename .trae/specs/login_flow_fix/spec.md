# 登录流程修复 - Product Requirement Document (v2)

## Overview
- **Summary**: 修复门户系统登录失败和浏览器跳转到 about:blank 页面的问题
- **Purpose**: 用户反馈门户类型系统登录失败，且浏览器跳转到 about:blank 页面
- **Target Users**: 测试平台的使用者

## Goals
- [Primary goal 1]: 修复门户系统登录流程，确保能正确导航到系统 URL
- [Primary goal 2]: 增强登录流程的 URL 验证和错误处理
- [Primary goal 3]: 添加详细日志便于调试

## Non-Goals (Out of Scope)
- 不修改业务逻辑的其他部分
- 不修改前端 UI 设计

## Background & Context
- 用户反馈：门户类型系统登录失败，浏览器跳转到 about:blank
- 关键代码位置：
  - `LoginInputSchema` 要求 `systemUrl` 必须是合法 URL
  - `runCredential` 和 `runNoLogin` 使用 `engine.navigate(url)` 导航
  - 前端从 `system.url` 获取系统 URL

## Functional Requirements
- **FR-1**: 登录流程必须验证 systemUrl 非空且有效
- **FR-2**: 如果 systemUrl 为空，返回明确错误信息
- **FR-3**: navigate 调用前必须检查 URL 有效性
- **FR-4**: 登录流程各阶段必须有详细日志

## Non-Functional Requirements
- **NFR-1**: 错误信息必须明确指出失败原因
- **NFR-2**: 日志必须包含 systemId、mode、systemUrl 等关键信息

## Constraints
- **Technical**: 使用 zod 验证输入，Playwright 控制浏览器

## Acceptance Criteria

### AC-1: URL 为空时返回错误
- **Given**: systemUrl 为空或 undefined
- **When**: 用户点击登录
- **Then**: 返回 failed 状态，错误信息为"系统 URL 未配置"
- **Verification**: `programmatic`

### AC-2: URL 有效时正确导航
- **Given**: systemUrl 为有效 URL
- **When**: 用户点击登录
- **Then**: 浏览器导航到正确的 URL
- **Verification**: `programmatic`

### AC-3: 日志完整输出
- **Given**: 任何登录模式
- **When**: 执行登录操作
- **Then**: 控制台输出完整日志
- **Verification**: `programmatic`
