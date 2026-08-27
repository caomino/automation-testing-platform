import { createHash } from 'node:crypto';
import type { FeatureEvidence, FeatureProfile } from '@test-platform/contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null';

  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

export function createEvidenceDigest(
  featureEvidence: Record<string, FeatureEvidence> | undefined,
  featureProfiles: FeatureProfile[] | undefined,
): string {
  const snapshot = stableStringify({ featureEvidence: featureEvidence ?? {}, featureProfiles: featureProfiles ?? [] });
  return `sha256:${createHash('sha256').update(snapshot).digest('hex')}`;
}
