import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTraceIdentityHeaders, traceEvent } from "../../src/lib/trace-event.js";

describe("traceEvent", () => {
  const originalRunsServiceUrl = process.env.RUNS_SERVICE_URL;
  const originalRunsServiceApiKey = process.env.RUNS_SERVICE_API_KEY;

  function restoreEnv(name: "RUNS_SERVICE_URL" | "RUNS_SERVICE_API_KEY", value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  beforeEach(() => {
    process.env.RUNS_SERVICE_URL = "https://runs-service.test";
    process.env.RUNS_SERVICE_API_KEY = "runs-api-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    restoreEnv("RUNS_SERVICE_URL", originalRunsServiceUrl);
    restoreEnv("RUNS_SERVICE_API_KEY", originalRunsServiceApiKey);
  });

  it("posts event details to runs-service with service auth and identity headers", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, statusText: "Accepted" }));
    vi.stubGlobal("fetch", fetchMock);

    traceEvent({
      runId: "run-123",
      event: "provider_cost.updated",
      detail: "Inserted provider cost for anthropic input tokens",
      identityHeaders: {
        "x-org-id": "org-123",
        "x-user-id": "user-123",
        "x-brand-id": "brand-123",
        "x-campaign-id": "campaign-123",
        "x-workflow-slug": "workflow",
        "x-feature-slug": "feature",
        "x-audience-id": "audience-123",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(new URL("https://runs-service.test/v1/runs/run-123/events"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "runs-api-key",
        "x-org-id": "org-123",
        "x-user-id": "user-123",
        "x-brand-id": "brand-123",
        "x-campaign-id": "campaign-123",
        "x-workflow-slug": "workflow",
        "x-feature-slug": "feature",
        "x-audience-id": "audience-123",
      },
      body: JSON.stringify({
        event: "provider_cost.updated",
        detail: "Inserted provider cost for anthropic input tokens",
      }),
    });
  });

  it("propagates inbound x-audience-id from request to runs-service egress (audience cost attribution)", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, statusText: "Accepted" }));
    vi.stubGlobal("fetch", fetchMock);

    const req = {
      headers: {
        "x-org-id": "org-123",
        "x-user-id": "user-123",
        "x-audience-id": "audience-456",
      },
    } as unknown as Request;

    const identityHeaders = getTraceIdentityHeaders(req);
    expect(identityHeaders["x-audience-id"]).toBe("audience-456");

    traceEvent({ runId: "run-123", event: "provider_cost.updated", detail: "x", identityHeaders });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["x-audience-id"]).toBe("audience-456");
  });

  it("omits x-audience-id on egress when absent inbound (optional, never throws)", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202, statusText: "Accepted" }));
    vi.stubGlobal("fetch", fetchMock);

    const req = { headers: { "x-org-id": "org-123", "x-user-id": "user-123" } } as unknown as Request;

    traceEvent({
      runId: "run-123",
      event: "provider_cost.updated",
      detail: "x",
      identityHeaders: getTraceIdentityHeaders(req),
    });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["x-audience-id"]).toBeUndefined();
  });

  it("does not call runs-service when config or runId is missing", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    delete process.env.RUNS_SERVICE_URL;
    traceEvent({
      runId: "run-123",
      event: "provider_cost.updated",
      detail: "Inserted provider cost for anthropic input tokens",
    });

    process.env.RUNS_SERVICE_URL = "https://runs-service.test";
    delete process.env.RUNS_SERVICE_API_KEY;
    traceEvent({
      runId: "run-123",
      event: "provider_cost.updated",
      detail: "Inserted provider cost for anthropic input tokens",
    });

    process.env.RUNS_SERVICE_API_KEY = "runs-api-key";
    traceEvent({
      runId: undefined,
      event: "provider_cost.updated",
      detail: "Inserted provider cost for anthropic input tokens",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not throw when runs-service rejects the event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500, statusText: "Internal Server Error" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    expect(() => {
      traceEvent({
        runId: "run-123",
        event: "provider_cost.updated",
        detail: "Inserted provider cost for anthropic input tokens",
      });
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[costs-service] traceEvent failed: 500 Internal Server Error");
    });
  });

  it("does not throw when fetch fails", async () => {
    const error = new Error("network down");
    const fetchMock = vi.fn().mockRejectedValue(error);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    expect(() => {
      traceEvent({
        runId: "run-123",
        event: "provider_cost.updated",
        detail: "Inserted provider cost for anthropic input tokens",
      });
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[costs-service] traceEvent failed:", error);
    });
  });
});
