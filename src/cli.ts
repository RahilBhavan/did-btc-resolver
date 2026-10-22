// Command line entry point: `resolve` and `demo`. Run with --help for usage.
import { parseArgs } from 'node:util';
import { resolve } from './resolver.ts';
import { rpcFromEnv, runLifecycle } from './regtest.ts';
import { EsploraSource } from './sources.ts';

const USAGE = `Usage:
  npm run resolve -- <did> [options]   (same as: node src/cli.ts resolve <did> [options])
  npm run demo                         (same as: node src/cli.ts demo)

Commands:
  resolve <did>  Resolve a did:btc DID and print the DID resolution result as JSON.
                 Exit code 1 if the result carries a resolution error.
  demo           Create, update and deactivate a new DID on a running regtest node,
                 then print the lifecycle as JSON. Mines regtest coins only.

Resolve options:
  --version-id N     Resolve version N. "0" is the creation; each later update or deactivation adds one.
  --version-time T   Resolve the version current at date-time T (for example 2026-10-22T12:00:00Z).
                     --version-id and --version-time cannot be combined.
  --esplora URL      Read chain data from an Esplora API instead of Bitcoin Core RPC.
  --network NAME     Network of the Esplora API: testnet (default) or regtest.

Options:
  -h, --help         Show this help.

Bitcoin Core RPC (resolve without --esplora, and demo):
  DID_BTC_RPC_URL (default http://127.0.0.1:18443), DID_BTC_RPC_USER, DID_BTC_RPC_PASSWORD.
  scripts/run-regtest.sh --keep starts a node and prints these values.`;

class UsageError extends Error {}

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        'version-id': { type: 'string' },
        'version-time': { type: 'string' },
        esplora: { type: 'string' },
        network: { type: 'string', default: 'testnet' },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parse(argv);
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const [command, did, ...extra] = positionals;
  if (command === 'resolve') {
    if (!did) throw new UsageError('resolve needs a DID');
    if (extra.length) throw new UsageError(`unexpected argument: ${extra[0]}`);
    if (values.network !== 'testnet' && values.network !== 'regtest') {
      throw new UsageError('--network must be testnet or regtest for this local demo');
    }
    const source = values.esplora ? new EsploraSource(values.esplora, values.network) : rpcFromEnv();
    const result = await resolve(did, source, { versionId: values['version-id'], versionTime: values['version-time'] });
    console.log(JSON.stringify(result, null, 2));
    return result.didResolutionMetadata.error ? 1 : 0;
  }
  if (command === 'demo') {
    if (did !== undefined) throw new UsageError(`unexpected argument: ${did}`);
    const lifecycle = await runLifecycle(rpcFromEnv(), (s) => console.error(s));
    console.log(JSON.stringify(lifecycle, null, 2));
    return 0;
  }
  throw new UsageError(command === undefined ? 'missing command' : `unknown command: ${command}`);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  const usage = err instanceof UsageError;
  console.error(`error: ${(err as Error).message}${usage ? `\n\n${USAGE}` : ''}`);
  process.exitCode = usage ? 2 : 1;
}
