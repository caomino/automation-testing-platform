/**
 * @file vendors.ts
 * @description AI 厂商预设配置表
 *   选择厂商后自动带出 Base URL 和可用模型列表
 * @frozen v1.0
 */

export type AIVendor =
  | 'openai'
  | 'azure'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'qwen'
  | 'zhipu'
  | 'minimax'
  | 'moonshot'
  | 'baichuan'
  | 'yi'
  | 'custom';

export interface VendorPreset {
  vendor: AIVendor;
  label: string;
  baseUrl: string;
  models: string[];
  description: string;
}

export const VENDOR_PRESETS: Record<AIVendor, VendorPreset> = {
  openai: {
    vendor: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    description: '原生 OpenAI API',
  },
  azure: {
    vendor: 'azure',
    label: 'Azure OpenAI',
    baseUrl: 'https://{resource}.openai.azure.com',
    models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'],
    description: 'Azure OpenAI Service（需替换 {resource}）',
  },
  anthropic: {
    vendor: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-sonnet'],
    description: 'Anthropic Claude API',
  },
  google: {
    vendor: 'google',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'],
    description: 'Google Gemini API',
  },
  deepseek: {
    vendor: 'deepseek',
    label: 'Deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    description: 'Deepseek AI API',
  },
  qwen: {
    vendor: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    description: '阿里巴巴通义千问 API',
  },
  zhipu: {
    vendor: 'zhipu',
    label: '智谱 AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-flash', 'glm-3-turbo'],
    description: '智谱 AI 开放平台',
  },
  minimax: {
    vendor: 'minimax',
    label: 'MiniMax (海螺AI)',
    baseUrl: 'https://api.minimax.chat/v1',
    models: ['MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5t-chat', 'abab6.5-chat', 'abab5.5-chat'],
    description: 'MiniMax 开放平台 (兼容 OpenAI 协议)',
  },
  moonshot: {
    vendor: 'moonshot',
    label: '月之暗面 (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    description: 'Moonshot AI 开放平台',
  },
  baichuan: {
    vendor: 'baichuan',
    label: '百川智能',
    baseUrl: 'https://api.baichuan-ai.com/v1',
    models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan2-Turbo'],
    description: '百川大模型 API',
  },
  yi: {
    vendor: 'yi',
    label: '零一万物 (Yi)',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    models: ['yi-large', 'yi-medium', 'yi-spark'],
    description: '零一万物大模型开放平台',
  },
  custom: {
    vendor: 'custom',
    label: '自定义/中转站',
    baseUrl: '',
    models: [],
    description: '兼容 OpenAI Chat Completions 的任意端点',
  },
};

export function getVendorPreset(vendor: AIVendor): VendorPreset | undefined {
  return VENDOR_PRESETS[vendor];
}

export function listVendors(): VendorPreset[] {
  return Object.values(VENDOR_PRESETS);
}

export function getModelsForVendor(vendor: AIVendor): string[] {
  return VENDOR_PRESETS[vendor]?.models ?? [];
}

export function getBaseUrlForVendor(vendor: AIVendor): string {
  return VENDOR_PRESETS[vendor]?.baseUrl ?? '';
}