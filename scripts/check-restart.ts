// Compare node-backed resolution with the lifecycle receipt after restarting the same regtest chain.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rpcFromEnv, type Lifecycle } from '../src/regtest.ts';
import { resolve } from '../src/resolver.ts';

const lifecycle: Lifecycle = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rpc = rpcFromEnv();
assert.equal((await rpc.call<{ chain: string }>('getblockchaininfo')).chain, 'regtest');
const latest = await resolve(lifecycle.did, rpc);
const saved = lifecycle.steps.find((s) => s.step === 'deactivate')?.resolution;
assert.ok(saved);
assert.deepEqual(latest, saved);
const historical = await resolve(lifecycle.did, rpc, { versionId: '1' });
assert.deepEqual(historical, lifecycle.steps.find((s) => s.step === 'resolve version 1 after deactivation')?.resolution);
assert.equal((await resolve(lifecycle.did, rpc, { versionId: '0' })).didResolutionMetadata.error, undefined);
console.error('Restart proof: latest and historical resolutions match the pre-restart receipt');
