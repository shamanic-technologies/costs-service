import { Request, Response, NextFunction } from "express";

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey || apiKey !== process.env.COSTS_SERVICE_API_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

const IDENTITY_EXEMPT_PREFIXES = ["/health", "/openapi.json", "/v1/platform-prices"];

function isIdentityExempt(path: string): boolean {
  return IDENTITY_EXEMPT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function requireIdentityHeaders(req: Request, res: Response, next: NextFunction) {
  if (isIdentityExempt(req.path)) {
    next();
    return;
  }

  const orgId = req.headers["x-org-id"] as string | undefined;
  const userId = req.headers["x-user-id"] as string | undefined;
  const runId = req.headers["x-run-id"] as string | undefined;

  if (!orgId || !userId || !runId) {
    const missing = [!orgId && "x-org-id", !userId && "x-user-id", !runId && "x-run-id"].filter(Boolean);
    res.status(400).json({ error: `Missing required headers: ${missing.join(", ")}` });
    return;
  }

  next();
}
