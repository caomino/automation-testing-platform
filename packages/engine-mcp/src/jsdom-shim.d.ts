/**
 * @file jsdom-shim.d.ts
 * @description jsdom 为测试依赖（仅 playwright-engine.semantic.test.ts 使用），monorepo 未引入 @types/jsdom；
 * 此处仅声明本包实际用到的 JSDOM 最小形态，避免为单一测试文件引入全量类型依赖。
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { pretendToBeVisual?: boolean; [k: string]: unknown });
    window: any;
  }
}
