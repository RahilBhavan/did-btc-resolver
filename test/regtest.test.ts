import assert from 'node:assert/strict';
import { it } from 'node:test';
import { rpcFromEnv, runLifecycle } from '../src/regtest.ts';

it('Bitcoin Core confirms create, key rotation, deactivation and rejects replay',
  { skip: !process.env.DID_BTC_REGTEST }, async () => {
    const result = await runLifecycle(rpcFromEnv());
    const steps = result.steps;
    assert.equal(steps.find(s => s.step === 'create')?.resolution?.didDocument?.id, result.did);
    assert.equal(steps.find(s => s.step === 'update')?.resolution?.didDocumentMetadata.versionId, '1');
    const deactivated = steps.find(s => s.step === 'deactivate')?.resolution;
    assert.equal(deactivated?.didDocument, null);
    assert.equal(deactivated?.didDocumentMetadata.deactivated, true);
    for (const s of steps) {
      if (s.resolution) assert.equal(s.resolution.didResolutionMetadata.error, undefined);
    }
    const credentials = steps.flatMap(s => s.credential ? [s.credential.verified] : []);
    assert.deepEqual(credentials, [true, false, true, false]);
    assert.match(steps.at(-1)?.txids[0] ?? '', /rejected:/);
  });
