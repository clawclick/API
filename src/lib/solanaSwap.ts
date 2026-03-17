import { randomBytes } from "node:crypto";

import { getOptionalEnv, getRequiredEnv, isConfigured } from "#config/env";
import { requestJson } from "#lib/http";
import {
  ACCOUNT_SIZE,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createInitializeAccountInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export type SolanaSwapParams = {
  walletAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippageBps: number;
};

export type UnsignedSolTx = {
  serializedTx: string;
  chainId: "solana";
  from: string;
};

type JupiterQuoteRoute = {
  swapInfo?: {
    ammKey?: string;
    label?: string;
    inputMint?: string;
    outputMint?: string;
    inAmount?: string;
    outAmount?: string;
    feeAmount?: string;
    feeMint?: string;
  };
  percent?: number;
  bps?: number | null;
};

export type JupiterQuoteResponse = {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  swapMode?: string;
  slippageBps?: number;
  priceImpactPct?: string;
  routePlan?: JupiterQuoteRoute[];
  platformFee?: {
    amount?: string;
    feeBps?: number;
  } | null;
};

type InstructionAccountMeta = {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
};

type SerializedInstruction = {
  programId: string;
  accounts: InstructionAccountMeta[];
  data: string;
};

type JupiterInstructionsResponse = {
  tokenLedgerInstruction?: SerializedInstruction | null;
  computeBudgetInstructions: SerializedInstruction[];
  setupInstructions: SerializedInstruction[];
  swapInstruction: SerializedInstruction;
  cleanupInstruction?: SerializedInstruction | null;
  otherInstructions: SerializedInstruction[];
  addressLookupTableAddresses: string[];
};

type SolanaDexOptions = {
  dexes?: string[];
  label: string;
};

const JUP_SWAP_API_BASE_URL = getOptionalEnv("JUP_SWAP_API_BASE_URL", "https://lite-api.jup.ag/swap/v1");
const SOL_FEE_BPS_DEFAULT = "10";
const FEE_DENOMINATOR = 10_000n;
const NATIVE_SOL_ALIASES = new Set(["sol", "solana", NATIVE_MINT.toBase58()]);

let connection: Connection | null = null;

function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(getRequiredEnv("SOL_RPC_URL"), "confirmed");
  }
  return connection;
}

function parseFeeBps(): bigint {
  const raw = getOptionalEnv("SOL_PROTOCOL_FEE_BPS", SOL_FEE_BPS_DEFAULT);
  const feeBps = Number(raw);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 100) {
    throw new Error(`SOL_PROTOCOL_FEE_BPS must be an integer between 0 and 100. Received: ${raw}`);
  }
  return BigInt(feeBps);
}

function normalizeMint(value: string): string {
  return isNativeSol(value) ? NATIVE_MINT.toBase58() : value;
}

function isNativeSol(value: string): boolean {
  return NATIVE_SOL_ALIASES.has(value.trim().toLowerCase());
}

function subtractFee(amount: bigint, feeBps: bigint): bigint {
  return amount - ((amount * feeBps) / FEE_DENOMINATOR);
}

function applyFee(amount: bigint, feeBps: bigint): bigint {
  return (amount * feeBps) / FEE_DENOMINATOR;
}

function toPublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${label} is not a valid Solana public key: ${value}`);
  }
}

function toInstruction(serialized: SerializedInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(serialized.programId),
    keys: serialized.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(serialized.data, "base64"),
  });
}

async function getAddressLookupTables(addresses: string[]): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) {
    return [];
  }

  const resolved = await Promise.all(
    addresses.map(async (address) => {
      const response = await getConnection().getAddressLookupTable(new PublicKey(address));
      if (!response.value) {
        throw new Error(`Missing Jupiter address lookup table: ${address}`);
      }
      return response.value;
    }),
  );

  return resolved;
}

async function getJupiterQuote(
  params: Omit<SolanaSwapParams, "walletAddress">,
  options: SolanaDexOptions,
): Promise<JupiterQuoteResponse> {
  const url = new URL(`${JUP_SWAP_API_BASE_URL}/quote`);
  url.searchParams.set("inputMint", normalizeMint(params.tokenIn));
  url.searchParams.set("outputMint", normalizeMint(params.tokenOut));
  url.searchParams.set("amount", params.amountIn);
  url.searchParams.set("slippageBps", String(params.slippageBps));
  if (options.dexes && options.dexes.length > 0) {
    url.searchParams.set("dexes", options.dexes.join(","));
  }
  return requestJson<JupiterQuoteResponse>(url.toString());
}

async function getJupiterSwapInstructions(
  walletAddress: string,
  quoteResponse: JupiterQuoteResponse,
  extraBody: Record<string, unknown>,
): Promise<JupiterInstructionsResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = getOptionalEnv("JUP_API_KEY");
  if (isConfigured(apiKey)) {
    headers["x-api-key"] = apiKey;
  }

  return requestJson<JupiterInstructionsResponse>(`${JUP_SWAP_API_BASE_URL}/swap-instructions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      userPublicKey: walletAddress,
      quoteResponse,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
      ...extraBody,
    }),
  });
}

async function composeVersionedTx(
  payer: PublicKey,
  instructions: TransactionInstruction[],
  lookupTableAddresses: string[],
): Promise<UnsignedSolTx> {
  const lookupTables = await getAddressLookupTables(lookupTableAddresses);
  const { blockhash } = await getConnection().getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables);

  const transaction = new VersionedTransaction(message);
  return {
    serializedTx: Buffer.from(transaction.serialize()).toString("base64"),
    chainId: "solana",
    from: payer.toBase58(),
  };
}

function buildInstructionList(instructionsResponse: JupiterInstructionsResponse): TransactionInstruction[] {
  const built: TransactionInstruction[] = [];

  for (const instruction of instructionsResponse.computeBudgetInstructions) {
    built.push(toInstruction(instruction));
  }
  for (const instruction of instructionsResponse.otherInstructions) {
    built.push(toInstruction(instruction));
  }
  for (const instruction of instructionsResponse.setupInstructions) {
    built.push(toInstruction(instruction));
  }
  if (instructionsResponse.tokenLedgerInstruction) {
    built.push(toInstruction(instructionsResponse.tokenLedgerInstruction));
  }
  built.push(toInstruction(instructionsResponse.swapInstruction));
  if (instructionsResponse.cleanupInstruction) {
    built.push(toInstruction(instructionsResponse.cleanupInstruction));
  }

  return built;
}

function getBuyFeeTreasury(): PublicKey {
  return toPublicKey(getRequiredEnv("SOL_FEE_TREASURY"), "SOL_FEE_TREASURY");
}

function validateQuote(quote: JupiterQuoteResponse, label: string): JupiterQuoteResponse {
  if (!quote.outAmount || !quote.otherAmountThreshold) {
    throw new Error(`${label} quote failed: no route found`);
  }
  return quote;
}

export async function getQuoteWithProtocolFee(
  params: Omit<SolanaSwapParams, "walletAddress">,
  options: SolanaDexOptions,
): Promise<{ amountOut: string; amountOutMin: string }> {
  const feeBps = parseFeeBps();
  const amountIn = BigInt(params.amountIn);
  const buyingWithNativeSol = isNativeSol(params.tokenIn) && !isNativeSol(params.tokenOut);

  if (buyingWithNativeSol) {
    const swapAmount = subtractFee(amountIn, feeBps);
    if (swapAmount <= 0n) {
      throw new Error("Input amount is too small after applying the SOL protocol fee.");
    }
    const quote = validateQuote(await getJupiterQuote({ ...params, tokenIn: NATIVE_MINT.toBase58(), amountIn: swapAmount.toString() }, options), options.label);
    return {
      amountOut: quote.outAmount!,
      amountOutMin: quote.otherAmountThreshold!,
    };
  }

  const quote = validateQuote(await getJupiterQuote(params, options), options.label);
  return {
    amountOut: quote.outAmount!,
    amountOutMin: quote.otherAmountThreshold!,
  };
}

export async function buildFeeAwareSwapTx(params: SolanaSwapParams, options: SolanaDexOptions): Promise<UnsignedSolTx> {
  const wallet = toPublicKey(params.walletAddress, "walletAddress");
  const feeBps = parseFeeBps();
  const amountIn = BigInt(params.amountIn);
  const buyingWithNativeSol = isNativeSol(params.tokenIn) && !isNativeSol(params.tokenOut);

  if (buyingWithNativeSol) {
    const feeAmount = applyFee(amountIn, feeBps);
    const swapAmount = amountIn - feeAmount;
    if (swapAmount <= 0n) {
      throw new Error("Input amount is too small after applying the SOL protocol fee.");
    }

    const quote = validateQuote(
      await getJupiterQuote({
        tokenIn: NATIVE_MINT.toBase58(),
        tokenOut: params.tokenOut,
        amountIn: swapAmount.toString(),
        slippageBps: params.slippageBps,
      }, options),
      options.label,
    );

    const instructionsResponse = await getJupiterSwapInstructions(wallet.toBase58(), quote, {
      wrapAndUnwrapSol: true,
    });

    const instructions: TransactionInstruction[] = [];
    for (const instruction of instructionsResponse.computeBudgetInstructions) {
      instructions.push(toInstruction(instruction));
    }
    for (const instruction of instructionsResponse.otherInstructions) {
      instructions.push(toInstruction(instruction));
    }
    if (feeAmount > 0n) {
      instructions.push(SystemProgram.transfer({
        fromPubkey: wallet,
        toPubkey: getBuyFeeTreasury(),
        lamports: Number(feeAmount),
      }));
    }
    for (const instruction of instructionsResponse.setupInstructions) {
      instructions.push(toInstruction(instruction));
    }
    if (instructionsResponse.tokenLedgerInstruction) {
      instructions.push(toInstruction(instructionsResponse.tokenLedgerInstruction));
    }
    instructions.push(toInstruction(instructionsResponse.swapInstruction));
    if (instructionsResponse.cleanupInstruction) {
      instructions.push(toInstruction(instructionsResponse.cleanupInstruction));
    }

    return composeVersionedTx(wallet, instructions, instructionsResponse.addressLookupTableAddresses);
  }

  const quote = validateQuote(await getJupiterQuote({
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    slippageBps: params.slippageBps,
  }, options), options.label);
  const instructionsResponse = await getJupiterSwapInstructions(wallet.toBase58(), quote, {
    wrapAndUnwrapSol: true,
  });

  return composeVersionedTx(wallet, buildInstructionList(instructionsResponse), instructionsResponse.addressLookupTableAddresses);
}