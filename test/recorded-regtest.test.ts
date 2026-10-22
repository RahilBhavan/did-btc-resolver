// This is an offline replay of a REAL local regtest run, distinct from MemChain vectors.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { resolve } from '../src/resolver.ts';
import { FixtureSource, type Recording } from '../src/sources.ts';

it('replays the node-confirmed regtest create/update/deactivate history offline', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/regtest-recording.json', import.meta.url), 'utf8')) as { did: string; recording: Recording };
  assert.equal(fixture.recording.network, 'regtest');
  const source = new FixtureSource(fixture.recording);
  const latest = await resolve(fixture.did, source);
  assert.equal(latest.didResolutionMetadata.error, undefined);
  assert.equal(latest.didDocument, null);
  assert.equal(latest.didDocumentMetadata.deactivated, true);
  const before = await resolve(fixture.did, source, { versionId: '0' });
  const after = await resolve(fixture.did, source, { versionId: '1' });
  assert.ok(before.didDocument);
  assert.ok(after.didDocument);
  assert.notDeepEqual(before.didDocument.verificationMethod, after.didDocument.verificationMethod);
  const invalid = await resolve(fixture.did, source, { minCreateConfirmations: -1 });
  assert.equal(invalid.didResolutionMetadata.error?.title, 'invalidOptions');
});
