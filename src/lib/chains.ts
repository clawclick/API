export type SupportedChain = "eth" | "base" | "bsc" | "sol";

export function normalizeChain(chain: string): SupportedChain {
  const value = chain.trim().toLowerCase();

  if (value === "eth" || value === "ethereum") {
    return "eth";
  }

  if (value === "base") {
    return "base";
  }

  if (value === "bsc" || value === "bnb" || value === "binance-smart-chain") {
    return "bsc";
  }

  if (value === "sol" || value === "solana") {
    return "sol";
  }

  throw new ChainError(`Unsupported chain "${chain}". Valid chains: eth, base, bsc, sol`);
}

/** Error thrown when a chain value is not recognized. Caught by the global error handler as a 400. */
export class ChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainError";
  }
}

export function isEvmChain(chain: SupportedChain): boolean {
  return chain !== "sol";
}

export function toEvmChainId(chain: SupportedChain): string | null {
  switch (chain) {
    case "eth":
      return "1";
    case "base":
      return "8453";
    case "bsc":
      return "56";
    default:
      return null;
  }
}

export function toDexScreenerChain(chain: SupportedChain): string | null {
  switch (chain) {
    case "eth":
      return "ethereum";
    case "base":
      return "base";
    case "bsc":
      return "bsc";
    case "sol":
      return "solana";
    default:
      return null;
  }
}

export function toGeckoTerminalNetwork(chain: SupportedChain): string | null {
  switch (chain) {
    case "eth":
      return "eth";
    case "base":
      return "base";
    case "bsc":
      return "bsc";
    default:
      return null;
  }
}

export function toCoinGeckoPlatform(chain: SupportedChain): string | null {
  switch (chain) {
    case "eth":
      return "ethereum";
    case "base":
      return "base";
    case "bsc":
      return "binance-smart-chain";
    default:
      return null;
  }
}

export function toAlchemyNetwork(chain: SupportedChain): string {
  switch (chain) {
    case "eth":
      return "eth-mainnet";
    case "base":
      return "base-mainnet";
    case "bsc":
      return "bnb-mainnet";
    case "sol":
      return "solana-mainnet";
  }
}