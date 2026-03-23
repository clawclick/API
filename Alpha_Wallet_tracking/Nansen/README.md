Nansen provider wrappers currently included in this repo:

- `GET /api/v1/labels` via `getLabels(address)`
- `POST /api/v1/token-screener` via `getTokenScreener(body)`
- `POST /api/v1/profiler/address/related-wallets` via `getAddressRelatedWallets(body)`
- `POST /api/v1/tgm/jup-dca` via `getJupiterDcas(body)`
- `POST /api/v1/smart-money/netflow` via `getSmartMoneyNetflow(body)`
- Existing smart-money holdings, DEX trades, and general search helpers

App routes exposed on top of these wrappers:

- `POST /tokenScreener`
- `POST /addressRelatedWallets`
- `POST /jupiterDcas`
- `POST /smartMoneyNetflow`
