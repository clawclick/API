# Solana Protocol Fee Program

Conservative Solana fee flow matching the EVM fee-wrapper design as closely as Solana allows.

## What this package covers

For `SOL`-in buys:
- no custom program is required
- backend composes one transaction with two parts:
  - `SystemProgram.transfer` of `0.1%` lamports to treasury
  - swap instructions using the reduced input amount

For token-in sells ending in native value:
- the safest atomic flow is to settle to `WSOL`, not directly split native `SOL` from one unknown-output swap
- swap output is sent to a program-controlled temporary `WSOL` vault
- this program measures the actual `WSOL` balance received
- it transfers `0.1%` to treasury `WSOL`
- it transfers the remainder to the user `WSOL`
- it closes the temporary vault and returns rent to the user

If you want the user to end with raw `SOL`, the backend can add one more instruction after settlement to close a temporary user-owned `WSOL` account. That unwrap step is better handled in transaction composition than inside this program.

## Why WSOL settlement is the easiest correct version

Splitting actual output from a single unknown-result swap is straightforward if the output lands in one temporary `WSOL` token account. Splitting directly into two final `SOL` recipients is not as clean because closing a wrapped-native account unwraps the full balance, not a partial percentage.

This version avoids guessing, keeps the fee based on actual output, and preserves atomicity.

## Program instructions

`initialize(fee_bps, treasury)`
- stores admin, treasury, fee bps, and PDA bumps

`update_treasury(treasury)`
- admin-only treasury update

`update_admin(new_admin)`
- admin-only authority rotation

Admin controls:
- `update_treasury(pubkey)` rotates the fee treasury wallet.
- `update_admin(pubkey)` rotates the program admin to a new deployer wallet.
- the `admin` stored in config controls treasury changes and admin rotation.

`settle_sell_wsol(min_net_out)`
- reads actual `WSOL` received in the program vault
- takes `fee_bps / 10_000`
- sends fee to treasury `WSOL`
- sends net amount to user `WSOL`
- closes the temporary vault account

## Required backend change

Current Solana providers in this repo return fully serialized upstream transactions:
- [DEX/Chain/SOL/RADYUM/provider.ts](/Users/zcsmacpro/VscProjects/API/DEX/Chain/SOL/RADYUM/provider.ts)
- [DEX/Chain/SOL/METEORA/provider.ts](/Users/zcsmacpro/VscProjects/API/DEX/Chain/SOL/METEORA/provider.ts)

That is too late to inject a safe fee flow.

To use this program, the backend needs to switch from "give me a final serialized tx" to "give me quote plus swap instructions" and then compose the final versioned transaction itself.

## Suggested sell flow

1. Create temporary program-owned `WSOL` vault ATA for the current swap.
2. Request Jupiter or router instructions with output directed to that vault.
3. Add swap instructions.
4. Add `settle_sell_wsol(min_net_out)` instruction.
5. Optionally add a final unwrap step for the user if using a temporary user `WSOL` destination.

## Suggested buy flow

1. Compute `fee = inputLamports / 1000`.
2. Compute `swapLamports = inputLamports - fee`.
3. Add treasury transfer instruction.
4. Request swap instructions for `swapLamports`.
5. Build one versioned transaction.

## Build note

This folder is a minimal standalone Anchor package. The repo does not currently include an Anchor workspace or deployment scripts, so building and deploying this program needs to happen from a Solana/Anchor environment.

Before deploy:
- replace the placeholder `declare_id!` in `src/lib.rs`
- decide the production treasury wallet
- decide whether user net settlement should go to a reusable `WSOL` ATA or a temporary `WSOL` account that gets closed in the same composed transaction