import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STRATS_DIR = join(__dirname, "..", "..", "strats");

export type StrategyListItem = {
  id: string;
  name: string;
  description: string;
  path: string;
};

const STRATEGY_REGISTRY: StrategyListItem[] = [
  {
    id: "swing-trade",
    name: "Swing Trader",
    description: "Find volatile high-volume tokens with 10%+ price swings and place entries/exits at support & resistance levels. Includes hold-off rules for failed rebounds.",
    path: "/strats/swing-trade",
  },
  {
    id: "scalping",
    name: "Hardened Scalper",
    description: "SOL-first, BSC-fallback intraday scalping guide focused on small, fast profits with strict liquidity, safety, slippage, and execution gates.",
    path: "/strats/scalping",
  },
];

export function listStrategies(): { strategies: StrategyListItem[] } {
  return { strategies: STRATEGY_REGISTRY };
}

/* ── Cache markdown content so we don't hit disk on every request ── */
const contentCache = new Map<string, { content: string; expiresAt: number }>();
const STRAT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function getStrategy(id: string): { id: string; name: string; content: string } | null {
  const entry = STRATEGY_REGISTRY.find((s) => s.id === id);
  if (!entry) return null;

  const hit = contentCache.get(id);
  if (hit && hit.expiresAt > Date.now()) {
    return { id: entry.id, name: entry.name, content: hit.content };
  }

  const filePath = join(STRATS_DIR, `${id}.md`);
  const content = readFileSync(filePath, "utf-8");
  contentCache.set(id, { content, expiresAt: Date.now() + STRAT_CACHE_TTL_MS });
  return { id: entry.id, name: entry.name, content };
}
