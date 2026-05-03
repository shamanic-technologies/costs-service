import type { Request } from "express";

const IDENTITY_HEADER_NAMES = [
  "x-org-id",
  "x-user-id",
  "x-brand-id",
  "x-campaign-id",
  "x-workflow-slug",
  "x-feature-slug",
] as const;

type IdentityHeaderName = (typeof IDENTITY_HEADER_NAMES)[number];
type HeaderValue = string | string[] | undefined;

export type TraceIdentityHeaders = Partial<Record<IdentityHeaderName, string>>;

export type TraceEventInput = {
  runId: string | undefined;
  event: string;
  detail: string;
  identityHeaders?: TraceIdentityHeaders;
};

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export function getTraceIdentityHeaders(req: Request): TraceIdentityHeaders {
  const headers: TraceIdentityHeaders = {};

  for (const headerName of IDENTITY_HEADER_NAMES) {
    const value = firstHeaderValue(req.headers[headerName]);
    if (value) {
      headers[headerName] = value;
    }
  }

  return headers;
}

export function traceEvent({ runId, event, detail, identityHeaders = {} }: TraceEventInput): void {
  const runsServiceUrl = process.env.RUNS_SERVICE_URL;
  const runsServiceApiKey = process.env.RUNS_SERVICE_API_KEY;

  if (!runId || !runsServiceUrl || !runsServiceApiKey) {
    return;
  }

  const url = new URL(`/v1/runs/${encodeURIComponent(runId)}/events`, runsServiceUrl);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": runsServiceApiKey,
  };

  for (const headerName of IDENTITY_HEADER_NAMES) {
    const value = identityHeaders[headerName];
    if (value) {
      headers[headerName] = value;
    }
  }

  void fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ event, detail }),
  })
    .then((response) => {
      if (!response.ok) {
        console.warn(`[costs-service] traceEvent failed: ${response.status} ${response.statusText}`);
      }
    })
    .catch((err) => {
      console.warn("[costs-service] traceEvent failed:", err);
    });
}
