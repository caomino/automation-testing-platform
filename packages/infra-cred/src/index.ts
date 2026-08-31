/**
 * @file index.ts
 * @description 凭证层实现（AES-256-GCM 加密落盘，绝不明文存储）
 * @frozen v1.0
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto, { randomUUID } from 'node:crypto';

export interface CredentialRecord {
  id: string;
  username: string;
  /** 加密后的密文引用（绝不明文落盘） */
  secretRef: string;
  createdAt: number;
}

export interface CredConfig {
  /** 凭证存储目录（外部化，如 D:/test-platform-data/credentials） */
  dir: string;
  /** 主密钥（从环境/用户口令派生；Web 形态下由会话提供） */
  masterKey: string;
}

export interface CredentialStore {
  /** 保存凭证，返回 credentialRef（供 System.credentials.credentialRef 引用） */
  save(username: string, password: string): Promise<string>;
  /** 按 ref 取回明文（仅运行时内存使用） */
  get(ref: string): Promise<{ username: string; password: string } | null>;
  delete(ref: string): Promise<void>;
  list(): Promise<CredentialRecord[]>;
}

/**
 * 应用级固定 salt：与 masterKey 一起用于 scrypt 派生 32 字节密钥。
 * 选择常量 salt 而非随机 salt 的原因：同一 masterKey 必须在任意进程/重启后
 * 派生出相同密钥，否则已落盘密文无法再解密。密钥强度完全依赖 masterKey 的熵。
 */
const APP_SALT = Buffer.from('test-platform-infra-cred-v1', 'utf8');

/** 从 masterKey 派生 32 字节 AES 密钥（scrypt，同步、确定性）。 */
function deriveKey(masterKey: string): Buffer {
  return crypto.scryptSync(masterKey, APP_SALT, 32);
}

/** 落盘 JSON 结构（不含任何明文口令）。 */
interface StoredCredential {
  id: string;
  username: string;
  iv: string;
  authTag: string;
  encrypted: string;
  createdAt: number;
}

export function createCredentialStore(config: CredConfig): CredentialStore {
  const { dir, masterKey } = config;
  const key = deriveKey(masterKey);

  async function ensureDir(): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  function filePath(ref: string): string {
    return path.join(dir, `${ref}.json`);
  }

  return {
    async save(username: string, password: string): Promise<string> {
      await ensureDir();
      const id = `cred-${randomUUID()}`;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      const record: StoredCredential = {
        id,
        username,
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        encrypted: encrypted.toString('base64'),
        createdAt: Date.now(),
      };
      await fs.writeFile(filePath(id), JSON.stringify(record), 'utf8');
      return id;
    },

    async get(ref: string): Promise<{ username: string; password: string } | null> {
      try {
        const raw = await fs.readFile(filePath(ref), 'utf8');
        const record = JSON.parse(raw) as StoredCredential;
        const iv = Buffer.from(record.iv, 'base64');
        const authTag = Buffer.from(record.authTag, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([
          decipher.update(Buffer.from(record.encrypted, 'base64')),
          decipher.final(),
        ]);
        return { username: record.username, password: decrypted.toString('utf8') };
      } catch {
        // 文件缺失或 GCM 认证失败（密钥/密文被篡改）均返回 null
        return null;
      }
    },

    async delete(ref: string): Promise<void> {
      try {
        await fs.unlink(filePath(ref));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    },

    async list(): Promise<CredentialRecord[]> {
      try {
        const entries = await fs.readdir(dir);
        const records: CredentialRecord[] = [];
        for (const name of entries) {
          if (!name.endsWith('.json')) {
            continue;
          }
          try {
            const raw = await fs.readFile(path.join(dir, name), 'utf8');
            const record = JSON.parse(raw) as StoredCredential;
            records.push({
              id: record.id,
              username: record.username,
              secretRef: record.id,
              createdAt: record.createdAt,
            });
          } catch {
            // 跳过损坏/非凭证文件
          }
        }
        records.sort((a, b) => a.createdAt - b.createdAt);
        return records;
      } catch {
        // 目录缺失时返回空列表
        return [];
      }
    },
  };
}
