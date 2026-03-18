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
];

export function listStrategies(): { strategies: StrategyListItem[] } {
  return { strategies: STRATEGY_REGISTRY };
}

export function getStrategy(id: string): { id: string; name: string; content: string } | null {
  const entry = STRATEGY_REGISTRY.find((s) => s.id === id);
  if (!entry) return null;

  const filePath = join(STRATS_DIR, `${id}.md`);
  const content = readFileSync(filePath, "utf-8");
  return { id: entry.id, name: entry.name, content };
}
