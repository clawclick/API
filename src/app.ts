import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import type { FastifyError } from "fastify";
import { ZodError } from "zod";
import { ChainError } from "#lib/chains";
import { registerRoutes } from "#routes/index";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(fastifyWebSocket);

  /* ── Global error handler ─────────────────────────────── */
  app.setErrorHandler((error: FastifyError | ZodError | ChainError | Error, request, reply) => {
    // Zod validation errors → 400 with structured field errors
    if (error instanceof ZodError) {
      const fields = error.issues.map((issue) => ({
        field: issue.path.join(".") || "(root)",
        message: issue.message,
        code: issue.code,
      }));
      reply.status(400).send({
        error: "Validation error",
        message: `Invalid query parameters: ${fields.map((f) => `${f.field} — ${f.message}`).join("; ")}`,
        fields,
      });
      return;
    }

    // Invalid chain → 400
    if (error instanceof ChainError) {
      reply.status(400).send({
        error: "Invalid chain",
        message: error.message,
      });
      return;
    }

    // Fastify validation errors (schema-level)
    if ("validation" in error && error.validation) {
      reply.status(400).send({
        error: "Validation error",
        message: error.message,
      });
      return;
    }

    // Log the full error for debugging
    request.log.error({ err: error, url: request.url, method: request.method }, "Unhandled route error");

    const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : error.message,
      message: statusCode >= 500
        ? `Something went wrong processing ${request.method} ${request.url}. Check server logs for details.`
        : error.message,
    });
  });

  /* ── 404 handler ──────────────────────────────────────── */
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: "Not found",
      message: `Route ${request.method} ${request.url} does not exist. Available endpoints: /health, /providers, /tokenPoolInfo, /tokenPriceHistory, /priceHistoryIndicators, /isScam, /fullAudit, /holderAnalysis, /fudSearch, /marketOverview, /walletReview, /swap, /swapQuote, /swapDexes, /trendingTokens, /newPairs, /topTraders, /gasFeed, /tokenSearch, /filterTokens, /volatilityScanner, /strats, /strats/:id, ws:/ws/launchpadEvents`,
    });
  });

  app.register(registerRoutes);

  return app;
}