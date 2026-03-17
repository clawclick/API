# Protocol Fee Wrapper

Conservative wrapper for ETH-chain swaps.

Purpose:
- Native-in buys: take `0.1%` from `msg.value`, forward the remainder to the whitelisted router.
- Token-in sells: execute the sell to the wrapper, unwrap any WETH received, then take `0.1%` from the actual native output and forward the remainder to the user.

Safety choices:
- Router whitelist only.
- Non-reentrant.
- No owner rescue function for user flow assets.
- Rejects fee-on-transfer / taxed input tokens for `sellTokenForNative` by requiring the wrapper receives exactly `amountIn`.

Deployment params for Ethereum:
- `wrappedNative`: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`
- `feeRecipient`: protocol treasury address
- `feeBps`: `10`
- `initialRouters`: chosen ETH router addresses to whitelist

Permit2-enabled variant:
- New contract file: `ProtocolFeeSwapWrapperPermit2.sol`
- Extra constructor param: `permit2` = `0x000000000022D473030F116dDEE9F6B43aC78BA3`
- Adds `sellTokenForNativeViaPermit2(...)` for Uniswap V4 / Universal Router sell flows
- Keeps the original `buyWithNative(...)` and `sellTokenForNative(...)` paths unchanged

Admin controls:
- `setFeeRecipient(address)` lets the owner rotate the treasury address.
- `setAllowedRouter(address,bool)` lets the owner update the router whitelist.
- `transferOwnership(address)` lets you move admin control to a new deployer wallet.

Backend requirements:
- For buys, backend-generated router calldata should set the swap recipient to the end user.
- For sells, backend-generated router calldata should set the swap recipient to the wrapper so it can measure and split proceeds safely.
- Prefer token -> WETH routes for sells, then let the wrapper unwrap and split.