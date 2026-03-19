import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyWebSocket from "@fastify/websocket";
import type { FastifyError } from "fastify";
import { ZodError } from "zod";
import { ChainError } from "#lib/chains";
import { AccessError, classifyPath, recordRequestMetric, requireAdminKey, requireApiKey } from "#services/apiRuntime";
import { registerRoutes } from "#routes/index";

type AuthenticatedRequest = {
  apiKeyId?: string;
};

function getPathname(url: string): string {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return url.split("?")[0] || "/";
  }
}

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(fastifyCors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed =
        /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
        /^https?:\/\/(www\.)?claw\.click$/.test(origin);
      cb(null, allowed);
    },
    credentials: true,
  });

  app.register(fastifyWebSocket);

  app.addHook("onRequest", async (request) => {
    if (request.method === "OPTIONS") return;

    const pathname = getPathname(request.raw.url ?? request.url);
    const classification = classifyPath(pathname);

    if (classification === "public" || classification === "unknown") {
      return;
    }

    if (classification === "admin") {
      requireAdminKey(request.headers as Record<string, unknown>);
      return;
    }

    // Client API key auth disabled for now — only admin key is enforced
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const authRequest = request as typeof request & AuthenticatedRequest;
    const path = request.routeOptions.url || getPathname(request.raw.url ?? request.url);

    try {
      await recordRequestMetric({
        path,
        statusCode: reply.statusCode,
        apiKeyId: authRequest.apiKeyId,
      });
    } catch (error) {
      request.log.error({ err: error, path }, "Failed to record request metrics");
    }

    return payload;
  });

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

    if (error instanceof AccessError) {
      reply.status(error.statusCode).send({
        error: error.statusCode === 401 ? "Unauthorized" : "Unavailable",
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
      message: `Route ${request.method} ${request.url} does not exist. Available endpoints: /health, /providers, /admin/apiKeys/generate, /admin/stats, /stats, /stats/requests, /stats/users, /stats/volume, /tokenPoolInfo, /tokenPriceHistory, /priceHistoryIndicators, /detailedTokenStats, /isScam, /fullAudit, /holderAnalysis, /holders, /fudSearch, /marketOverview, /walletReview, /swap, /swapQuote, /swapDexes, /approve, /unwrap, /trendingTokens, /newPairs, /topTraders, /gasFeed, /tokenSearch, /tokenHolders, /filterTokens, /volatilityScanner, /strats, /strats/:id, ws:/ws/launchpadEvents`,
    });
  });

  app.register(registerRoutes);

  return app;
}