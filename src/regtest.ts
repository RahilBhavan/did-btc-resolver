// End-to-end create -> update -> deactivate lifecycle against a Bitcoin Core regtest node.
// Coins come from regtest block rewards only. The function refuses to run on any other chain.
import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { networks, payments, Transaction } from 'bitcoinjs-lib';
import { buildCreateTx, buildDeactivateTx, buildUpdateTxs, TaprootSigner, type Utxo } from './creator.ts';
import { formatDidBtc } from './did.ts';
import { encodeMultikey, type PublicKey } from './multikey.ts';
import { VR } from './protocol.ts';
import { resolve, type ResolutionResult } from './resolver.ts';
import { BitcoinCoreRpc } from './sources.ts';
import { signEddsaJcs2022, verifyCredential, type VerifyResult } from './vc.ts';

export interface LifecycleStep {
  step: string;
  txids: string[];
  resolution?: ResolutionResult;
  credential?: VerifyResult & { label: string };
}

export interface Lifecycle {
  did: string;
  steps: LifecycleStep[];
}

const WALLET = 'did-btc-demo';

async function ensureWallet(rpc: BitcoinCoreRpc): Promise<string> {
  const loaded = await rpc.call<string[]>('listwallets');
  if (!loaded.includes(WALLET)) {
    try {
      await rpc.call('loadwallet', [WALLET]);
    } catch {
      await rpc.call('createwallet', [WALLET]);
    }
  }
  rpc.config.wallet = WALLET;
  const address = await rpc.call<string>('getnewaddress', [], true);
  const balance = await rpc.call<number>('getbalance', [], true);
  if (balance < 1) await rpc.call('generatetoaddress', [101, address]);
  return address;
}

async function mine(rpc: BitcoinCoreRpc, minerAddress: string, n = 1): Promise<void> {
  await rpc.call('generatetoaddress', [n, minerAddress]);
}

async function broadcast(rpc: BitcoinCoreRpc, ...txs: Transaction[]): Promise<string[]> {
  const ids: string[] = [];
  for (const tx of txs) ids.push(await rpc.call<string>('sendrawtransaction', [tx.toHex()]));
  return ids;
}

async function position(rpc: BitcoinCoreRpc, txid: string): Promise<{ blockHeight: number; txIndex: number }> {
  const tx = await rpc.call<{ blockhash: string }>('getrawtransaction', [txid, 1]);
  const block = await rpc.call<{ height: number; tx: string[] }>('getblock', [tx.blockhash, 1]);
  return { blockHeight: block.height, txIndex: block.tx.indexOf(txid) };
}

async function fundSigner(rpc: BitcoinCoreRpc, signer: TaprootSigner, minerAddress: string, btc = 0.01): Promise<Utxo> {
  const address = payments.p2tr({ internalPubkey: signer.xOnly, network: networks.regtest }).address!;
  const txid = await rpc.call<string>('sendtoaddress', [address, btc], true);
  await mine(rpc, minerAddress);
  const tx = Transaction.fromHex(await rpc.call<string>('getrawtransaction', [txid, 0]));
  const vout = tx.outs.findIndex((o) => Buffer.from(o.script).equals(Buffer.from(signer.outputScript)));
  return { txid, vout, value: tx.outs[vout].value };
}

function credential(did: string, keyIndex: number, secretKey: Uint8Array) {
  return signEddsaJcs2022(
    {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: ['VerifiableCredential'],
      issuer: did,
      validFrom: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      credentialSubject: { id: 'did:example:demo-holder', note: 'regtest demo credential; no real-world meaning' },
    },
    { type: 'DataIntegrityProof', cryptosuite: 'eddsa-jcs-2022', verificationMethod: `${did}#key-${keyIndex}`, proofPurpose: 'assertionMethod' },
    secretKey,
  );
}

export async function runLifecycle(rpc: BitcoinCoreRpc, log: (s: string) => void = () => {}): Promise<Lifecycle> {
  const { chain } = await rpc.call<{ chain: string }>('getblockchaininfo');
  if (chain !== 'regtest') throw new Error(`refusing to run: node is on "${chain}", not regtest`);
  const minerAddress = await ensureWallet(rpc);
  const steps: LifecycleStep[] = [];

  // Fresh random keys for every run (regtest only; they are discarded at exit).
  const funder = new TaprootSigner(randomBytes(32));
  const controller = new TaprootSigner(randomBytes(32));
  const subjectSecret = randomBytes(32);
  const subjectKey: PublicKey = { type: 'ed25519', bytes: ed25519.getPublicKey(subjectSecret) };

  // 1. create
  const funding = await fundSigner(rpc, funder, minerAddress);
  const createTx = buildCreateTx({ funding, fundingSigner: funder, subjectKey, controller });
  const createIds = await broadcast(rpc, createTx);
  await mine(rpc, minerAddress, 6); // spec §Create: wait 6 blocks before publishing the identifier
  const pos = await position(rpc, createIds[0]);
  const did = formatDidBtc('regtest', pos.blockHeight, pos.txIndex);
  log(`created ${did} (tx ${createIds[0]}, block ${pos.blockHeight}, index ${pos.txIndex})`);
  steps.push({ step: 'create', txids: createIds, resolution: await resolve(did, rpc) });

  const vc0 = credential(did, 0, subjectSecret);
  steps.push({ step: 'verify credential signed with key-0', txids: [], credential: { label: 'vc0', ...(await verifyCredential(vc0, rpc)) } });

  // 2. update: rotate the subject key and add a service
  const newSecret = randomBytes(32);
  const newKey = encodeMultikey({ type: 'ed25519', bytes: ed25519.getPublicKey(newSecret) });
  const { commit, reveal } = buildUpdateTxs({
    didUtxo: { txid: createIds[0], vout: 1, value: createTx.outs[1].value },
    controller,
    update: {
      vm: [{ i: 0, k: newKey, vr: VR.authentication | VR.assertionMethod }],
      a: [{ service: [{ id: `${did}#demo`, type: 'LinkedDomains', serviceEndpoint: 'https://example.com' }] }],
    },
  });
  const updateIds = await broadcast(rpc, commit, reveal);
  await mine(rpc, minerAddress);
  log(`updated: commit ${updateIds[0]}, reveal ${updateIds[1]}`);
  steps.push({ step: 'update', txids: updateIds, resolution: await resolve(did, rpc) });
  steps.push({ step: 'verify old credential after key rotation', txids: [], credential: { label: 'vc0', ...(await verifyCredential(vc0, rpc)) } });
  const vc1 = credential(did, 0, newSecret);
  steps.push({ step: 'verify credential signed with the new key-0', txids: [], credential: { label: 'vc1', ...(await verifyCredential(vc1, rpc)) } });

  // 3. deactivate
  const deactivateTx = buildDeactivateTx({ didUtxo: { txid: updateIds[1], vout: 0, value: reveal.outs[0].value }, controller });
  const deactivateIds = await broadcast(rpc, deactivateTx);
  await mine(rpc, minerAddress);
  log(`deactivated: ${deactivateIds[0]}`);
  steps.push({ step: 'deactivate', txids: deactivateIds, resolution: await resolve(did, rpc) });
  steps.push({ step: 'verify credential after deactivation', txids: [], credential: { label: 'vc1', ...(await verifyCredential(vc1, rpc)) } });
  steps.push({ step: 'resolve version 1 after deactivation', txids: [], resolution: await resolve(did, rpc, { versionId: '1' }) });

  // 4. replay: re-broadcasting the confirmed update is rejected by the node
  try {
    await broadcast(rpc, reveal);
    steps.push({ step: 'replay old reveal transaction', txids: ['accepted (unexpected)'] });
  } catch (err) {
    steps.push({ step: 'replay old reveal transaction', txids: [`rejected: ${(err as Error).message}`] });
  }
  return { did, steps };
}

export function rpcFromEnv(): BitcoinCoreRpc {
  const url = process.env.DID_BTC_RPC_URL ?? 'http://127.0.0.1:18443';
  const user = process.env.DID_BTC_RPC_USER;
  const password = process.env.DID_BTC_RPC_PASSWORD;
  if (!user || !password) throw new Error('set DID_BTC_RPC_USER and DID_BTC_RPC_PASSWORD for the regtest node');
  return new BitcoinCoreRpc({ url, user, password }, 'regtest');
}
