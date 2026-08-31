# @test-platform/infra-cred

凭证加密存储层，为企业管理系统自动化测试平台提供凭证的安全落盘与读取能力。

## 职责说明

本包定义凭证的抽象接口 `CredentialStore`，负责凭证的加密存储与检索。当前实现为 **Web 形态（本地加密文件）**，后期可无缝切换至 **Electron safeStorage** 后端，业务层无感知。

## 接口文档

### `CredentialStore`

| 方法 | 签名 | 说明 |
|---|---|---|
| `save` | `(username: string, password: string) => Promise<string>` | 加密保存凭证，返回 `credentialRef`（唯一 ID）。密文落盘，绝不明文存储。 |
| `get` | `(ref: string) => Promise<{ username: string; password: string } \| null>` | 按 ref 取回明文凭证，仅在运行时内存中使用；找不到或解密失败返回 `null`。 |
| `delete` | `(ref: string) => Promise<void>` | 删除指定凭证文件；ref 不存在时静默忽略（ENOENT）。 |
| `list` | `() => Promise<CredentialRecord[]>` | 列出所有凭证元数据（不含明文密码），按 `createdAt` 升序排序；损坏文件自动跳过。 |

### 类型定义

```ts
interface CredentialRecord {
  id: string;
  username: string;
  secretRef: string;
  createdAt: number;
}

interface CredConfig {
  dir: string;       // 凭证存储目录
  masterKey: string; // 主密钥（由环境变量或用户口令派生）
}
```

## 安全说明

- **AES-256-GCM 加密**：每条凭证使用独立随机 IV（12 字节）加密，GCM 提供认证完整性校验。
- **密钥派生**：主密钥通过 `scrypt`（固定 salt `test-platform-infra-cred-v1`）派生 32 字节 AES 密钥，同一主密钥在任意进程/重启后派生出相同密钥。
- **绝不明文落盘**：磁盘 JSON 文件仅保存 `{id, username, iv, authTag, encrypted, createdAt}`，无任何明文口令字段。
- **篡改检测**：GCM 的 authTag 确保密文被篡改后 `get()` 会返回 `null`，不会泄露任何信息。
- **加密隔离**：不同 `masterKey` 派生出不同密钥，互相无法解密对方的密文。

## safeStorage 切换点

当前实现使用本地 JSON 文件 + AES-256-GCM 加密。切换到 Electron `safeStorage` 时：

1. **接口不变**：`CredentialStore` 接口完全不变，业务层零改动。
2. **仅换工厂实现**：只需替换 `createCredentialStore(config)` 内部实现，将 `fs.writeFile`/`fs.readFile` 替换为 `electron-store` 或 `safeStorage` 的 API。
3. **建议架构**：可在包内实现两种 Provider（`FileCredProvider` / `SafeStorageCredProvider`），通过配置项切换：

```ts
// 切换示例（伪代码）
const store = process.platform === 'electron'
  ? createSafeStorageStore(config)   // Electron safeStorage 后端
  : createCredentialStore(config);   // 当前文件加密后端
```

4. **迁移注意**：safeStorage 由系统密钥链保护，无需自行管理 masterKey；迁移时需提供一次性迁移脚本，将现有 JSON 密文批量导入 safeStorage。

## 使用示例

```ts
import { createCredentialStore } from '@test-platform/infra-cred';

const store = createCredentialStore({
  dir: 'D:/test-platform-data/credentials',
  masterKey: process.env.CRED_MASTER_KEY ?? 'user-derived-passphrase',
});

// 保存凭证
const ref = await store.save('db-admin', 'p@ssw0rd!');

// 读取凭证（仅内存中使用，不落地）
const cred = await store.get(ref);
if (cred) {
  // 使用 cred.username / cred.password
}

// 列出所有凭证
const all = await store.list();

// 删除凭证
await store.delete(ref);
```

## 依赖说明

### 运行时依赖
- **Node.js `crypto`**：AES-256-GCM 加密与 scrypt 密钥派生（Node 18+ 内置）
- **Node.js `fs` / `path`**：文件系统操作

### 开发依赖
- `typescript ^5.7.2`：编译
- `vitest ^2.1.8`：测试框架
- `zod ^3.23.8`：运行时校验（预留）

---

## 7. 迭代指南

### 7.1 扩展点

#### 切换到 Electron safeStorage
创建 `SafeStorageCredProvider` 实现，在工厂函数中根据运行环境选择：
```typescript
export function createCredentialStore(config: CredConfig): CredentialStore {
  if (process.platform === 'electron') {
    return new SafeStorageCredProvider(config);
  }
  return new FileCredProvider(config);
}
```

#### 新增加密算法
在 `encrypt()` / `decrypt()` 函数中添加算法分支，支持 AES-256-GCM 以外的加密方式。

#### 扩展凭证元数据
在 `CredentialRecord` 接口中添加可选字段，支持更多元数据信息。

### 7.2 常见修改场景

#### 修改密钥派生参数
调整 `scrypt` 函数的参数（N、r、p），平衡安全性和性能。

#### 添加凭证过期机制
在 `get()` 方法中检查 `expiresAt` 字段，过期凭证返回 `null`。

### 7.3 测试要点
- 加密/解密正确性测试
- 篡改检测测试
- 并发访问测试
- 文件损坏恢复测试

### 7.4 注意事项
- **密钥管理**：`masterKey` 的存储和传输必须安全
- **内存安全**：明文凭证仅在使用期间存在于内存中
- **权限控制**：凭证文件的访问权限应设置为仅所有者可读写
- **备份策略**：定期备份凭证存储目录