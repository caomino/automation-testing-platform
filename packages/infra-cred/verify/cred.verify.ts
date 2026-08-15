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
