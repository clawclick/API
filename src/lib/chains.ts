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

  throw new Error(`Unsupported chain: ${chain}`);
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