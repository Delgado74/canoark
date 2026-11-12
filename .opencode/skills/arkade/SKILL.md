---
name: arkade
description: >-
  Build Bitcoin applications with Arkade and its TypeScript SDK
  (@arkade-os/sdk): wallets, offchain payments, boarding and offboarding,
  renewal of virtual outputs, asset issuance, Tapscript contracts, and
  Lightning payments and asset exchange through Arkade Intents. Use when a task
  mentions Arkade, Ark Labs, @arkade-os packages, Arkade addresses (ark1 or
  tark1), virtual outputs, or VTXOs.
---

# Arkade

Arkade enforces programmable spending conditions on Bitcoin outputs. Every Arkade transaction is a Bitcoin transaction, and every Arkade output is a Bitcoin output with spending paths that the operator checks before it signs. Applications can also execute transactions offchain, as virtual outputs that settle on Bitcoin in batches. Arkade works on Bitcoin today with Taproot, without consensus changes. It is not a Layer 2, sidechain, blockchain, or rollup.

Your application connects to the Arkade operator through the SDK. By default, the SDK executes transactions offchain, and they are preconfirmed instantly. When a user needs Bitcoin finality, a batch swap settles their virtual outputs onchain. If the operator is unavailable, users can still exit to Bitcoin on their own.

- Docs: https://docs.arkadeos.com
- Page index: https://docs.arkadeos.com/llms.txt
- Docs MCP server: https://docs.arkadeos.com/mcp
- SDK source: https://github.com/arkade-os/ts-sdk
- SDK reference: https://arkade-os.github.io/ts-sdk/

## Rules

- **Never invent SDK APIs, types, parameters, or example values.** If this file and the docs do not cover a call, read the SDK source.
- State which network your code targets: mainnet, mutinynet, signet, or regtest.
- Keep SDK convenience behavior separate from protocol guarantees.
- There is one operator. Say "the operator", never "operators" or "an operator". Developers can run their own operator only in regtest.
- Unilateral exit is the emergency path if the operator is unavailable. Do not present it as routine.
- In prose, say "virtual output". The SDK calls a virtual output a `Vtxo` (`getVtxos`, `VtxoManager`). Use SDK identifiers exactly as written.
- "Intent" means Arkade Intents only. The SDK's `Intent` namespace builds operator requests: BIP322-signed messages to the operator, such as batch registration requests. It is unrelated to Arkade Intents.
- Activity happens "within Arkade", not "on Arkade". Do not say "smart contract" or "DeFi".
- Translate deprecated terms once, then use only the current term:

| Deprecated | Current |
|---|---|
| "Ark service provider", "ASP", "Ark server" | the operator |
| "round" | batch swap |
| "round transaction" | commitment transaction |
| "Ark address" | Arkade address |
| "Ark transaction", "out-of-round transaction", "arkoor" | Arkade transaction |
| "refresh" (of virtual outputs) | renew, renewal |

- Arkade is not a variant of "Ark protocol". Do not use ark-protocol.org, Bitcoin Optech's Ark topic, or clArk ("Covenant-less Ark") materials as sources for Arkade.

## Networks

| Network | Operator URL | Explorer |
|---|---|---|
| Bitcoin mainnet | `https://arkade.computer` | https://arkade.space |
| Mutinynet | `https://mutinynet.arkade.sh` | https://explorer.mutinynet.arkade.sh |
| Signet | `https://signet.arkade.sh` | https://explorer.signet.arkade.sh |
| Regtest (local) | `http://localhost:7070` | Run [arkade-regtest](https://github.com/ArkLabsHQ/arkade-regtest) |

The SDK defaults to mainnet. On a test network, pass the operator URL and create the identity with `{ isMainnet: false }`. The SDK throws if the identity's network does not match the operator's network.

## Create a Wallet

Requires Node.js 22.13 or later.

```bash
pnpm add @arkade-os/sdk
```

A 12-word mnemonic controls the wallet and its funds. Generate it once (for example with `generateMnemonic` from `@scure/bip39`), store it securely, and load the same one on every run. Funds sent to a wallet whose mnemonic was not stored are lost.

```ts
import { MnemonicIdentity, RestArkProvider, Wallet } from '@arkade-os/sdk'

// Mainnet, the default
const identity = MnemonicIdentity.fromMnemonic(process.env.ARKADE_MNEMONIC!)
const wallet = await Wallet.create({ identity })

// A test network: pass the operator URL from the Networks table
const testIdentity = MnemonicIdentity.fromMnemonic(process.env.ARKADE_MNEMONIC!, { isMainnet: false })
const testWallet = await Wallet.create({
  identity: testIdentity,
  arkProvider: new RestArkProvider('https://mutinynet.arkade.sh'),
})

const address = await wallet.getAddress() // ark1… on mainnet, tark1… on test networks
```

Use `MnemonicIdentity` or `SeedIdentity`. `SingleKey` exists for legacy integrations that manage raw private keys.

### In Node.js

The wallet stores its data in IndexedDB and receives events through `EventSource`. Node.js has neither, so a Node.js wallet needs three more steps:

```ts
import { configureEventSource, InMemoryContractRepository, InMemoryWalletRepository, Wallet } from '@arkade-os/sdk'
import { EventSource } from 'eventsource' // pnpm add eventsource

// 1. Before Wallet.create. Without it, boarding, renewal, and offboarding throw.
configureEventSource((url) => new EventSource(url))

// 2. Storage. Without it, reads such as getBalance() throw.
const wallet = await Wallet.create({
  identity,
  storage: {
    walletRepository: new InMemoryWalletRepository(),
    contractRepository: new InMemoryContractRepository(),
  },
})

// 3. When you are done. Without it, the process never exits.
await wallet.dispose()
```

`dispose()` stops renewal, contract watching and the operator subscriptions. It doesn't close storage: close a SQLite connection yourself after it resolves. `Wallet` also supports `await using`.

In-memory storage loses its data when the process exits. Use it for tests and one-off scripts. For an application, use the SQLite repositories: see [Storage](https://docs.arkadeos.com/wallets/advanced/storage#sqlite).

## Receive

Share the Arkade address from `wallet.getAddress()`. The recipient does not need to be online. Assets arrive at the same address as BTC.

```ts
import { waitForIncomingFunds } from '@arkade-os/sdk'

// Wait for one deposit
const incoming = await waitForIncomingFunds(wallet)
if (incoming.type === 'vtxo') console.log(incoming.newVtxos) // Arkade payments
if (incoming.type === 'utxo') console.log(incoming.coins)    // boarding deposits

// Or subscribe
const stop = await wallet.notifyIncomingFunds((funds) => {
  // update application state
})
stop()
```

Reconnect interrupted subscriptions, and deduplicate events after a restart.

## Check Balances

```ts
const { available, recoverable, boarding, availableAssets } = await wallet.getBalance()
// available: settled + preconfirmed sats, spendable now
// recoverable: expired or sub-dust sats (see "Renew and Recover")
// boarding.total: onchain deposits waiting to board
// availableAssets: spendable assets, as [{ assetId, amount: bigint }]

const vtxos = await wallet.getVtxos()
// Each output has txid, vout, value (sats), and the flags isPreconfirmed, isSwept, isSpent, isUnrolled

// To choose outputs to spend, leave out recoverable ones
const spendable = await wallet.getSpendableVtxos({ withRecoverable: false })
```

## Send

```ts
// BTC amounts are numbers, in satoshis
const txid = await wallet.send({ address: 'ark1…', amount: 50_000 })

// Asset amounts are bigint base units. Without `amount`, the output carries dust BTC.
await wallet.send({ address, amount: 5000, assets: [{ assetId, amount: 200n }] })
```

After an interruption or reconnect, finalize pending transactions:

```ts
const { finalized, pending } = await wallet.finalizePendingTxs()
```

- To pay a Lightning invoice, see [Arkade Intents](#arkade-intents-developer-preview).
- To send to a Bitcoin address (`bc1` or `tb1`), offboard with `Ramps`. On mutinynet, you can also pay it through a solver with the swap client.

## Board and Offboard

Boarding moves confirmed onchain bitcoin into Arkade. Offboarding moves bitcoin from Arkade to a Bitcoin address. Both join the next batch, so both need onchain transactions and confirmation waits.

```ts
import { Ramps } from '@arkade-os/sdk'

const { fees } = await wallet.arkProvider.getInfo()

// Board: fund this address onchain, wait for confirmation, then call onboard
const boardingAddress = await wallet.getBoardingAddress()
const onboardTxid = await new Ramps(wallet).onboard(fees)

// Offboard: the amount is optional bigint sats; omit it to offboard everything
const offboardTxid = await new Ramps(wallet).offboard('bc1q…', fees, 50_000n)
```

If the operator is unavailable, a user can exit unilaterally with `Unroll.sessionFor` and `Unroll.completeUnroll`. This takes several onchain transactions and fees. See [Boarding & Offboarding](https://docs.arkadeos.com/wallets/advanced/boarding#unilateral-exit).

## Renew and Recover

A virtual output is **preconfirmed** (cosigned offchain, so it relies on the operator) or **settled** (anchored onchain by a batch swap). Each virtual output expires with its batch, so it must be renewed before it expires. An output that expired, was swept, or is sub-dust is recoverable.

`Wallet.create` renews and recovers automatically while the app runs. Every minute, it renews outputs that expire within `vtxoThreshold` (default 3 days), and settles recoverable outputs and confirmed boarding deposits in the same batch swap. Add no renewal code of your own.

- **Renewal stops when the app stops.** Set `settlementConfig: { vtxoThreshold }`, in seconds, to at least the longest time the app stays closed. For a wallet that stays offline longer, use [delegation](https://docs.arkadeos.com/learn/concepts/expiry-and-renewal#delegation).
- To renew manually instead, create the wallet with `settlementConfig: false`, then call `renewVtxos()` and `recoverVtxos()` on `await wallet.getVtxoManager()` before outputs expire. Never construct a second `VtxoManager`: it competes with the wallet's for the same outputs.

SDK 0.4 deprecates `renewalConfig` (`enabled`, `thresholdMs`), and SDK 0.5 removes it. Use `settlementConfig`.

## Assets

Asset amounts are `bigint` base units. Every asset sits on a virtual output that also holds BTC, so issuing needs available BTC.

```ts
// A control asset allows reissuance. Without one, supply is capped forever.
const { assetId: controlAssetId } = await wallet.assetManager.issue({ amount: 1n })

const { arkTxId, assetId } = await wallet.assetManager.issue({
  amount: 1_000_000n,
  controlAssetId, // optional
  metadata: { name: 'Example', ticker: 'EXM', decimals: 2 }, // optional, immutable
})

await wallet.assetManager.reissue({ assetId, amount: 300n }) // you must hold the control asset
await wallet.assetManager.burn({ assetId, amount: 400n })
```

- Use the metadata `decimals` field to display amounts.
- Burning the control asset permanently disables reissuance.
- Each virtual output lists the assets it holds in its `assets` field.

## Contracts

Write a contract in Arkade Script, compile it with `arkadec` (`cargo install arkade-compiler --locked`, Rust 1.85 or newer), and spend it through `Arkade.connect`. The operator runs an emulator-enforced path's Arkade Script before it cosigns. This example uses the savings vault from [Your First Contract](https://docs.arkadeos.com/learn/first-contract), compiled with `arkadec savings_vault.ark -o savings_vault.json`.

```ts
import fs from 'node:fs'
import { Arkade, arkade, ArkAddress, InMemoryContractRepository } from '@arkade-os/sdk'

const client = await Arkade.connect({
  service: { network: 'bitcoin' },
  identity,
  storage: { contractRepository: new InMemoryContractRepository() },
})

const program = arkade.programFromArtifact(JSON.parse(fs.readFileSync('savings_vault.json', 'utf8')))
const recipient = ArkAddress.decode('ark1…')
const contract = client.contract(program, {
  owner: await identity.xOnlyPublicKey(),
  'recipientScript.program': recipient.vtxoTaprootKey,
  'recipientScript.version': 1n,
  unlockAt: 1767225600n,
})
await contract.register({ label: 'savings-vault' })
console.log(contract.address) // fund this address first

const [output] = await contract.getUtxos()
const { txid } = await contract.functions
  .release()
  .from(output)
  .to(recipient.pkScript, BigInt(output.value))
  .send()
client.dispose()
```

- Load the artifact with `arkade.programFromArtifact`. `parseArtifact` reads a different format.
- **Write an exit path that passes `serverExitDelay` to `older`.** Without an `older` path, the contract's outputs can't renew in a batch swap. The client binds the operator's exit delay, and the address depends on it, so register the contract to keep it.
- On a test network, pass `service: { operatorUrl, emulatorUrl }`. Without `emulatorUrl`, emulator-enforced paths stay off.

See [Compiler](https://docs.arkadeos.com/learn/concepts/compiler) and [Vaults](https://docs.arkadeos.com/vaults/overview).

To build a contract application end to end, install the contract skills from [`arkade-os/skills`](https://github.com/arkade-os/skills) with `npx skills add arkade-os/skills`. They take you from the contract decision through `arkadec`, the SDK spend, and the screen to a regtest test.

## Arkade Intents (Developer Preview)

Arkade Intents lets applications pay and receive over Lightning, pay Bitcoin addresses, and exchange assets. A solver carries each swap across. The swap client in `@arkade-os/swap` finds the solver, checks its quote, funds the swap, and claims or refunds it. Every route follows one flow: intent, quote, fund, fill.

| Route | Status |
|---|---|
| Pay a Lightning invoice (`arkade:bitcoin/slip44:0 → bolt11:bitcoin/slip44:0`) | Available for testing on mainnet, with one pinned solver |
| Receive over Lightning (`bolt11:bitcoin/slip44:0 → arkade:bitcoin/slip44:0`) | Available for testing on mainnet, with one pinned solver |
| Exchange BTC and assets (`arkade:mutinynet/slip44:1 ↔ arkade:mutinynet/asset:<68 hex>`) | Testing on mutinynet (BTC/USDT) |
| Pay a Bitcoin address (`arkade:mutinynet/slip44:1 → bitcoin:mutinynet/slip44:1`) | Testing on mutinynet only |
| Take a deposit from a Bitcoin address (`bitcoin:bitcoin/slip44:0 → arkade:bitcoin/slip44:0`) | Not available |

### Create the Swap Client

```bash
pnpm add @arkade-os/sdk @arkade-os/swap nostr-tools
```

```ts
import { createSwapClient, IndexedDbAssetSwapRepository } from '@arkade-os/swap'
// The developer-preview Lightning solver's card
import lightningCard from './beta-solver.card.json' with { type: 'json' }

const client = createSwapClient({
  wallet,
  repository: new IndexedDbAssetSwapRepository(),
  discovery: { localCards: [{ card: lightningCard, network: 'bitcoin' }] },
})
await client.ready
```

- **Keep one client running for the life of the app.** The client claims and refunds swaps only while it runs.
- The repository stores each swap's secrets. There is no default. In Node, use `SQLiteAssetSwapRepository`, as in [Choose Storage](https://docs.arkadeos.com/intents/build/swap-client#choose-storage).
- The mainnet registry does not list the Lightning solver yet, so pin its card. [Lightning Payments](https://docs.arkadeos.com/intents/build/lightning#setup) shows the card. Without it, `pay` and `receive` throw `UnsupportedRoute`.
- For mutinynet routes, create the client with a mutinynet wallet and no pinned card. The client reads the registry for the wallet's network.

### Pay a Lightning Invoice

```ts
import { btcOn } from '@arkade-os/swap'

const result = await client.pay(bolt11, {
  maxFee: { amount: 500n, asset: btcOn('arkade', 'bitcoin') },
})
if (result.kind !== 'swap') throw new Error('expected a swap')

client.onUpdate(({ swap, outcome }) => {
  if (swap.id === result.swap.id) console.log(outcome) // paid or refunded
})
```

- `pay` throws before it funds anything if the invoice is not usable (`AmbiguousDestination`), the solver declines (`SwapRefusal`), or the fee is more than `maxFee` (`MaxFeeExceeded`).
- If the solver never pays, the client refunds the lockup itself after the quote's `refundLocktime`. The outcome is then `refunded`.
- `pay` also accepts an Arkade address. That is a plain wallet payment, and `pay` returns `{ kind: 'payment', txid }`.

### Receive over Lightning

```ts
const request = await client.receive({ via: 'lightning', amount: 10_000n }) // sats you receive
console.log(request.artifact.bolt11) // show this invoice to the payer
```

- **Keep the client running until the payer pays.** The client claims the payment. The outcome is `claimed`, or `lapsed` if the claim window closes first.
- Show only an invoice that `receive` or `accept` returns. An invoice from `quote` alone has no saved claim secret.
- For LNURL and Lightning address callbacks, quote with `amountOn: 'give'`, then call `accept`. See [LNURL and Lightning Addresses](https://docs.arkadeos.com/intents/build/lightning#lnurl-and-lightning-addresses).

### Exchange Assets

On mutinynet:

```ts
import { asset } from '@arkade-os/sdk'
import { arkadeAsset, btcOn } from '@arkade-os/swap'

const USDT_ID = 'f121ac9b7656797cc68d1e8fecacfbaa2069ec1461edf0bf2f3c37404cb9791a0000' // USDT's asset id on mutinynet
const BTC = btcOn('arkade', 'mutinynet')
const USDT = arkadeAsset('mutinynet', asset.AssetId.fromString(USDT_ID))

const swap = await client.exchange({
  give: BTC,
  take: USDT,
  amount: 100_000n, // sats you give
  amountOn: 'give',
  maxFee: { amount: 50n, asset: USDT }, // the fee is charged in the asset you receive
})
```

- Exactly one side is BTC. The client refuses an asset-for-asset swap.
- `amount` is a `bigint` in the asset's smallest unit. Convert what a user types with `Amount.parse`.
- Give at least the card's minimum. The client does not check it, and the solver does not fill a smaller swap.
- An unfilled swap has no fill deadline. Cancel it with `client.cancel(swap.id)`. If `cancel` reports `filled`, the deposit was already spent and the swap completed.
- In Node, live updates need an `EventSource` implementation.

### Pay a Bitcoin Address

On mutinynet:

```ts
import { btcOn } from '@arkade-os/swap'

const result = await client.pay(bitcoinAddress, {
  amount: 5_000n, // sats the recipient gets
  maxFee: { amount: 2_000n, asset: btcOn('arkade', 'mutinynet') },
})
```

- **Keep the client running until the outcome is `claimed`.** The client builds and broadcasts the onchain claim.
- To move bitcoin into or out of Arkade with no solver, board or offboard with `Ramps`.

For solver access or partnerships, contact help@arklabs.xyz.

## More Docs

- [Technical Primer](https://docs.arkadeos.com/learn/primer)
- [Virtual Outputs](https://docs.arkadeos.com/learn/concepts/virtual-outputs)
- [Settlement & Finality](https://docs.arkadeos.com/learn/concepts/settlement-and-finality)
- [Expiry & Renewal](https://docs.arkadeos.com/learn/concepts/expiry-and-renewal)
- [Security & Trust Model](https://docs.arkadeos.com/learn/concepts/security-and-trust-model)
- [Glossary](https://docs.arkadeos.com/learn/glossary)
- [Developer Resources](https://docs.arkadeos.com/wallets/getting-started/developer-resources): networks, explorers, and local regtest
- [Storage](https://docs.arkadeos.com/wallets/advanced/storage) and [Service Worker](https://docs.arkadeos.com/wallets/advanced/service-worker)
- [Verify Asset Metadata](https://docs.arkadeos.com/assets/verify-metadata) and [Detect Asset Deposits](https://docs.arkadeos.com/assets/detect-deposits)
- [Arkade Intents](https://docs.arkadeos.com/intents) and [Developer Preview](https://docs.arkadeos.com/intents/developer-preview)
- [Build with AI Agents](https://docs.arkadeos.com/learn/ai-agents): the docs MCP server and the docs as text files
