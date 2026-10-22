import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENV = { ...process.env, DID_BTC_RPC_USER: '', DID_BTC_RPC_PASSWORD: '' };

function run(file: string, args: string[], command = 'node') {
  const r = spawnSync(command, [file, ...args], { cwd: ROOT, env: ENV, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}
const cli = (...args: string[]) => run('src/cli.ts', args);

describe('command line usage', () => {
  for (const args of [['--help'], ['-h'], ['resolve', '--help'], ['demo', '--help'], ['resolve', 'did:btc:test:xuh5-ayyy-q3q0-kp0', '-h']]) {
    it(`${args.join(' ')} prints usage and exits 0 without contacting a node`, () => {
      const r = cli(...args);
      assert.equal(r.code, 0);
      assert.match(r.stdout, /^Usage:/);
      for (const flag of ['--version-id', '--version-time', '--esplora', '--network', 'demo']) assert.ok(r.stdout.includes(flag), flag);
      assert.equal(r.stderr, '');
    });
  }

  for (const [args, message] of [
    [['resolve', 'did:btc:test:xuh5-ayyy-q3q0-kp0', '--bogus'], /Unknown option '--bogus'/],
    [['resolve'], /resolve needs a DID/],
    [['frob'], /unknown command: frob/],
    [[], /missing command/],
    [['demo', 'extra'], /unexpected argument: extra/],
    [['resolve', 'did:btc:test:xuh5-ayyy-q3q0-kp0', '--network', 'mainnet'], /--network must be testnet or regtest/],
  ] as [string[], RegExp][]) {
    it(`"${args.join(' ')}" prints a short error and usage, not a stack trace`, () => {
      const r = cli(...args);
      assert.equal(r.code, 2);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^error: /);
      assert.match(r.stderr, message);
      assert.match(r.stderr, /\nUsage:/);
      assert.doesNotMatch(r.stderr, /\n\s+at /);
    });
  }

  it('a missing RPC configuration is a one-line error with exit code 1', () => {
    const r = cli('demo');
    assert.equal(r.code, 1);
    assert.equal(r.stderr.trim(), 'error: set DID_BTC_RPC_USER and DID_BTC_RPC_PASSWORD for the regtest node');
  });
});

describe('script usage', () => {
  for (const [file, command] of [
    ['scripts/run-regtest.sh', 'bash'],
    ['scripts/record-fixture.ts', 'node'],
    ['scripts/regtest-proof.ts', 'node'],
    ['scripts/check-restart.ts', 'node'],
    ['scripts/restore_data.py', 'python3'],
  ]) {
    it(`${file} --help prints usage and exits 0`, () => {
      const r = run(file, ['--help'], command);
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /^Usage:/);
    });
    it(`${file} rejects an unknown option with usage`, () => {
      const r = run(file, ['--bogus'], command);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /^error: unknown option --bogus\n/);
      assert.match(r.stderr, /Usage:/);
    });
  }

  it('run-regtest.sh --help documents --keep', () => {
    assert.match(run('scripts/run-regtest.sh', ['--help'], 'bash').stdout, /--keep/);
  });
});
