import { test, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createCredentialStore } from '../src/index';

interface TempConfig {
  dir: string;
  masterKey: string;
}

function makeConfig(): TempConfig {
  const dir = path.join(os.tmpdir(), `infra-cred-test-${randomSuffix()}`);
  return { dir, masterKey: 'test-master-key-123' };
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2);
}

async function cleanup(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

test('save then get round-trips password and stores no plaintext on disk', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  const ref = await store.save('alice', 's3cret-password');
  const got = await store.get(ref);
  expect(got).not.toBeNull();
  expect(got?.username).toBe('alice');
  expect(got?.password).toBe('s3cret-password');

  const raw = await fs.readFile(path.join(config.dir, `${ref}.json`), 'utf8');
  const parsed = JSON.parse(raw);
  expect(parsed).not.toHaveProperty('password');
  await cleanup(config.dir);
});

test('get returns null for unknown ref', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  expect(await store.get('cred-nonexistent')).toBeNull();
  await cleanup(config.dir);
});

test('delete removes credential and list reflects removal', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  const ref = await store.save('bob', 'pw');
  expect(await store.get(ref)).not.toBeNull();
  await store.delete(ref);
  expect(await store.get(ref)).toBeNull();

  const list = await store.list();
  expect(list.find((r) => r.secretRef === ref)).toBeUndefined();
  await cleanup(config.dir);
});

// ---- 正向测试 ----

test('list returns multiple records sorted by createdAt ascending', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  const r1 = await store.save('user-a', 'pw1');
  await new Promise((r) => setTimeout(r, 10));
  const r2 = await store.save('user-b', 'pw2');
  await new Promise((r) => setTimeout(r, 10));
  const r3 = await store.save('user-c', 'pw3');

  const list = await store.list();
  expect(list).toHaveLength(3);
  expect(list[0].id).toBe(r1);
  expect(list[1].id).toBe(r2);
  expect(list[2].id).toBe(r3);
  await cleanup(config.dir);
});

test('different masterKeys produce isolated encryption — cannot decrypt cross-store', async () => {
  const cfgA = makeConfig();
  cfgA.masterKey = 'master-key-alpha';
  const cfgB = makeConfig();
  cfgB.masterKey = 'master-key-beta';

  const storeA = createCredentialStore(cfgA);
  const storeB = createCredentialStore(cfgB);

  const refFromA = await storeA.save('alice', 'secret-alpha');
  await storeB.save('bob', 'secret-beta');

  expect(await storeA.get(refFromA)).not.toBeNull();
  expect(await storeB.get(refFromA)).toBeNull();

  await cleanup(cfgA.dir);
  await cleanup(cfgB.dir);
});

test('GCM tamper detection returns null when ciphertext is modified', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  const ref = await store.save('alice', 's3cret');

  const filePath = path.join(config.dir, `${ref}.json`);
  const raw = await fs.readFile(filePath, 'utf8');
  const record = JSON.parse(raw);

  const orig = record.encrypted;
  const tampered = Buffer.from(orig, 'base64');
  tampered[0] ^= 0x01;
  record.encrypted = tampered.toString('base64');

  await fs.writeFile(filePath, JSON.stringify(record), 'utf8');

  expect(await store.get(ref)).toBeNull();
  await cleanup(config.dir);
});

// ---- 反向测试 ----

test('corrupted JSON file is skipped and list remains unaffected', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  const r1 = await store.save('good-user', 'good-pw');

  await fs.writeFile(
    path.join(config.dir, 'corrupt.json'),
    'this is not valid json{{{',
    'utf8',
  );

  const list = await store.list();
  expect(list).toHaveLength(1);
  expect(list[0].id).toBe(r1);
  await cleanup(config.dir);
});

test('delete on non-existent ref does not throw (ENOENT ignored)', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  await expect(store.delete('cred-does-not-exist')).resolves.not.toThrow();
  await cleanup(config.dir);
});

test('wrong masterKey cannot decrypt credentials encrypted by another key', async () => {
  const cfg1 = makeConfig();
  cfg1.masterKey = 'correct-key';
  const cfg2 = makeConfig();
  cfg2.masterKey = 'wrong-key';
  cfg2.dir = cfg1.dir;

  const store1 = createCredentialStore(cfg1);
  const store2 = createCredentialStore(cfg2);

  const ref = await store1.save('alice', 'correct-password');

  expect(await store2.get(ref)).toBeNull();
  expect(await store1.get(ref)).not.toBeNull();
  await cleanup(cfg1.dir);
});

// ---- 边界测试 ----

test('empty password encrypts and decrypts correctly', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  const ref = await store.save('empty-pw-user', '');
  const got = await store.get(ref);
  expect(got).not.toBeNull();
  expect(got?.username).toBe('empty-pw-user');
  expect(got?.password).toBe('');
  await cleanup(config.dir);
});

test('password with special characters round-trips correctly', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);
  const specialPw = 'p@$$w0rd!#%^&*()_+-=[]{}|;:\'",.<>?/`~💎🔒🗝️';
  const ref = await store.save('special-user', specialPw);
  const got = await store.get(ref);
  expect(got?.password).toBe(specialPw);
  await cleanup(config.dir);
});

test('concurrent save/get operations are reliable', async () => {
  const config = makeConfig();
  const store = createCredentialStore(config);

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      store.save(`user-${i}`, `password-${i}`).then((ref) => ({
        ref,
        username: `user-${i}`,
        password: `password-${i}`,
      })),
    ),
  );

  const verified = await Promise.all(
    results.map(async ({ ref, username, password }) => {
      const got = await store.get(ref);
      return got?.username === username && got?.password === password;
    }),
  );

  expect(verified.every(Boolean)).toBe(true);
  const list = await store.list();
  expect(list).toHaveLength(20);
  await cleanup(config.dir);
});
