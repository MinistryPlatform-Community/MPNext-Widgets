/**
 * Unit tests for ApiClient (packages/embed-sdk/src/shared/api-client.ts)
 *
 * Notes:
 * - `fetch` is mocked on `globalThis` for each test.
 * - The current `refreshToken()` implementation always returns `null`, so the
 *   public 401 retry path can only be exercised by stubbing the private method.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClient, type ApiClientConfig } from "./api-client";

/** Build a Response-like object compatible with what ApiClient consumes. */
function makeResponse(
  body: unknown,
  init: { status?: number; ok?: boolean; statusText?: string } = {},
): Response {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    status,
    ok,
    statusText: init.statusText ?? "OK",
    json: async () => body,
  } as unknown as Response;
}

describe("ApiClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let getToken: ReturnType<typeof vi.fn>;
  let onTokenRefresh: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    getToken = vi.fn(async () => "test-token");
    onTokenRefresh = vi.fn();
    // Override the global fetch used inside ApiClient.
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const baseConfig = (
    overrides: Partial<ApiClientConfig> = {},
  ): ApiClientConfig => ({
    apiHost: "https://api.example.com",
    getToken,
    onTokenRefresh,
    ...overrides,
  });

  describe("constructor", () => {
    it("accepts an apiHost and token provider", () => {
      const client = new ApiClient(baseConfig());
      expect(client).toBeInstanceOf(ApiClient);
    });

    it("works without optional onTokenRefresh", () => {
      const client = new ApiClient({
        apiHost: "https://api.example.com",
        getToken,
      });
      expect(client).toBeInstanceOf(ApiClient);
    });
  });

  describe("request()", () => {
    it("sets Authorization: Bearer header from getToken()", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({ ok: true }));
      const client = new ApiClient(baseConfig());

      await client.request("/widgets");

      expect(getToken).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.example.com/widgets");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("includes X-Tenant-ID header when tenantId is configured", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({}));
      const client = new ApiClient(baseConfig({ tenantId: "test-tenant" }));

      await client.request("/data");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Tenant-ID"]).toBe("test-tenant");
    });

    it("omits X-Tenant-ID when tenantId is not configured", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({}));
      const client = new ApiClient(baseConfig());

      await client.request("/data");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["X-Tenant-ID"]).toBeUndefined();
    });

    it("merges caller-supplied headers and forwards Idempotency-Key", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({}));
      const client = new ApiClient(baseConfig());

      await client.request("/x", {
        headers: { "Idempotency-Key": "abc-123", "X-Custom": "y" },
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("abc-123");
      expect(headers["X-Custom"]).toBe("y");
      // Auth still applied
      expect(headers.Authorization).toBe("Bearer test-token");
    });

    it("uses credentials: omit and mode: cors", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({}));
      const client = new ApiClient(baseConfig());

      await client.request("/x");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.credentials).toBe("omit");
      expect(init.mode).toBe("cors");
    });

    it("returns parsed JSON body on success", async () => {
      const payload = { id: 7, name: "calendar" };
      fetchMock.mockResolvedValueOnce(makeResponse(payload));
      const client = new ApiClient(baseConfig());

      const result = await client.request<typeof payload>("/widget/7");

      expect(result).toEqual(payload);
    });

    it("throws with server error message on non-2xx response", async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({ error: "Bad widget" }, { status: 400, ok: false, statusText: "Bad Request" }),
      );
      const client = new ApiClient(baseConfig());

      await expect(client.request("/x")).rejects.toThrow("Bad widget");
    });

    it("falls back to statusText when the error body has no error field", async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({}, { status: 500, ok: false, statusText: "Internal Server Error" }),
      );
      const client = new ApiClient(baseConfig());

      await expect(client.request("/x")).rejects.toThrow(/Internal Server Error/);
    });

    it("falls back to statusText when the error body is unparsable JSON", async () => {
      const badResponse = {
        status: 502,
        ok: false,
        statusText: "Bad Gateway",
        json: async () => {
          throw new Error("not json");
        },
      } as unknown as Response;
      fetchMock.mockResolvedValueOnce(badResponse);
      const client = new ApiClient(baseConfig());

      await expect(client.request("/x")).rejects.toThrow(/Bad Gateway/);
    });

    it("retries exactly once after a 401 and surfaces the second response", async () => {
      // First call returns 401, second call returns 200.
      fetchMock
        .mockResolvedValueOnce(
          makeResponse({}, { status: 401, ok: false, statusText: "Unauthorized" }),
        )
        .mockResolvedValueOnce(makeResponse({ ok: true }));

      const client = new ApiClient(baseConfig());
      // Force refreshToken() to return a non-null value so the retry branch runs.
      const refreshSpy = vi
        .spyOn(client as unknown as { refreshToken: () => Promise<string | null> }, "refreshToken")
        .mockResolvedValue("new-token");

      const result = await client.request<{ ok: boolean }>("/x");

      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true });
    });

    it("does not loop infinitely if 401 persists after retry", async () => {
      fetchMock.mockResolvedValue(
        makeResponse({ error: "still unauth" }, {
          status: 401,
          ok: false,
          statusText: "Unauthorized",
        }),
      );

      const client = new ApiClient(baseConfig());
      vi.spyOn(client as unknown as { refreshToken: () => Promise<string | null> }, "refreshToken")
        .mockResolvedValue("another-token");

      await expect(client.request("/x")).rejects.toThrow();
      // First call + exactly one retry; nothing more.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry on 401 when onTokenRefresh is not configured", async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({ error: "nope" }, { status: 401, ok: false, statusText: "Unauthorized" }),
      );

      const client = new ApiClient({
        apiHost: "https://api.example.com",
        getToken,
        // no onTokenRefresh
      });

      await expect(client.request("/x")).rejects.toThrow("nope");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry on 401 when skipRetry is set by the caller", async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({ error: "nope" }, { status: 401, ok: false, statusText: "Unauthorized" }),
      );

      const client = new ApiClient(baseConfig());
      const refreshSpy = vi
        .spyOn(client as unknown as { refreshToken: () => Promise<string | null> }, "refreshToken")
        .mockResolvedValue("new-token");

      await expect(
        client.request("/x", { skipRetry: true } as RequestInit & { skipRetry: boolean }),
      ).rejects.toThrow("nope");

      expect(refreshSpy).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not retry on non-401 errors", async () => {
      fetchMock.mockResolvedValueOnce(
        makeResponse({ error: "boom" }, { status: 500, ok: false, statusText: "Server Error" }),
      );

      const client = new ApiClient(baseConfig());
      const refreshSpy = vi
        .spyOn(client as unknown as { refreshToken: () => Promise<string | null> }, "refreshToken")
        .mockResolvedValue("new-token");

      await expect(client.request("/x")).rejects.toThrow("boom");
      expect(refreshSpy).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("post()", () => {
    it("serializes body as JSON and sets method POST", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({ created: true }));
      const client = new ApiClient(baseConfig());

      const result = await client.post<{ created: boolean }>("/things", {
        name: "Pickle",
        count: 3,
      });

      expect(result).toEqual({ created: true });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.example.com/things");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ name: "Pickle", count: 3 }));
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers.Authorization).toBe("Bearer test-token");
    });

    it("forwards additional init like Idempotency-Key header through post()", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({}));
      const client = new ApiClient(baseConfig());

      await client.post("/things", { a: 1 }, {
        headers: { "Idempotency-Key": "key-xyz" },
      });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Idempotency-Key"]).toBe("key-xyz");
    });
  });

  describe("get()", () => {
    it("sets method GET and applies Authorization header", async () => {
      fetchMock.mockResolvedValueOnce(makeResponse({ x: 1 }));
      const client = new ApiClient(baseConfig());

      const result = await client.get<{ x: number }>("/things");

      expect(result).toEqual({ x: 1 });
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("GET");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-token");
    });
  });
});
