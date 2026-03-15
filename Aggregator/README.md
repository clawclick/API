## Super API scaffold

Primary backend stack:

- Fastify
- TypeScript
- Zod

Initial endpoints:

- `/tokenPoolInfo`
- `/tokenPriceHistory`
- `/isScam`
- `/fullAudit`
- `/holderAnalysis`
- `/fudSearch`
- `/marketOverview`

Run locally:

```bash
npm install
npm run dev
```

Provider starter files live beside each source folder as `connect.ts`. Each starter performs one basic request so the integration can be expanded later into normalized adapters under `src/`.

Doc-verified starter coverage currently includes Moralis, Dune, Birdeye, CoinGecko Pro, DexScreener, Honeypot.is, GoPlus token security, Reddit OAuth client credentials, Telegram Bot API, X recent search, and Etherscan V2 gas endpoints.

Private or premium vendors with less accessible public docs still need manual verification before being treated as production-ready adapters.
