// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultChatTransport } from "ai";

import { createDefaultWorkspaceSnapshot } from "@/lib/default-workspace";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import {
  WorkspaceRuntimeClient,
  resolveWorkspaceRuntimeBaseUrl,
  resolveWorkspaceRuntimeRequestCredentials,
  resolveWorkspaceRuntimeRequestHeaders,
} from "@/lib/runtime-client";

interface MockSocket {
  url: string;
  close: ReturnType<typeof vi.fn>;
  trigger(event: string, payload?: unknown): void;
}

function installWebSocketMock(): {
  sockets: MockSocket[];
  webSocketConstructor: ReturnType<typeof vi.fn>;
} {
  const sockets: MockSocket[] = [];
  const webSocketConstructor = vi.fn(function MockWebSocket(this: Record<string, unknown>, url: string) {
    const handlers = new Map<string, Array<(payload?: unknown) => void>>();
    const close = vi.fn();

    this.OPEN = 1;
    this.readyState = 1;
    this.url = url;
    this.close = close;
    this.addEventListener = vi.fn((event: string, handler: (payload?: unknown) => void) => {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    });

    sockets.push({
      url,
      close,
      trigger(event, payload) {
        for (const handler of handlers.get(event) ?? []) {
          handler(payload);
        }
      },
    });
  });

  vi.stubGlobal("WebSocket", webSocketConstructor as unknown as typeof WebSocket);

  return {
    sockets,
    webSocketConstructor,
  };
}

describe("WorkspaceRuntimeClient", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses the current browser host for the default runtime base url", () => {
    vi.stubGlobal("location", new URL("http://localhost:5173/") as unknown as Location);

    expect(resolveWorkspaceRuntimeBaseUrl()).toBe("http://localhost:4301");
  });

  it("surfaces the server's error field instead of raw JSON text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "You've hit your usage limit. Try again later." }), {
            status: 500,
            headers: {
              "content-type": "application/json",
            },
          }),
        ),
      ),
    );

    const client = new WorkspaceRuntimeClient();

    await expect(
      client.sendTemplateStudioChat({
        templateId: "template-product-pod",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow("You've hit your usage limit. Try again later.");
  });

  it("posts project directory browsing requests to the web endpoint", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          path: "/tmp/workspace-root",
          parentPath: "/tmp",
          isWorkspaceRoot: true,
          entries: [
            {
              name: "demo-project",
              path: "/tmp/workspace-root/demo-project",
            },
          ],
          inspection: {
            path: "/tmp/workspace-root",
            projectName: "workspace-root",
            projectInteractiveDirectory: "/tmp/workspace-root/.openaquarium/interactive",
            hasOpenAquariumDirectory: false,
            canImport: false,
            roomCount: 0,
            rooms: [],
          },
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WorkspaceRuntimeClient();

    await expect(client.browseProjectDirectory({ path: "/tmp/workspace-root" })).resolves.toMatchObject({
      path: "/tmp/workspace-root",
      entries: [{ name: "demo-project", path: "/tmp/workspace-root/demo-project" }],
    });
    const browseCall = fetchMock.mock.calls[0];
    expect(browseCall).toBeDefined();
    const [browseUrl, init] = browseCall as unknown as [string, RequestInit];
    expect(browseUrl).toBe(`${client.baseUrl}/api/system/project-path/browse`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ path: "/tmp/workspace-root" }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("posts manual project path inspection requests to the web endpoint", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          path: "/tmp/manual-project",
          projectName: "Manual Project",
          projectInteractiveDirectory: "/tmp/manual-project/.openaquarium/interactive",
          hasOpenAquariumDirectory: false,
          canImport: false,
          roomCount: 0,
          rooms: [],
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WorkspaceRuntimeClient();

    await expect(client.inspectProjectPath({ path: "/tmp/manual-project" })).resolves.toMatchObject({
      path: "/tmp/manual-project",
      projectName: "Manual Project",
    });
    const inspectCall = fetchMock.mock.calls[0];
    expect(inspectCall).toBeDefined();
    const [inspectUrl, init] = inspectCall as unknown as [string, RequestInit];
    expect(inspectUrl).toBe(`${client.baseUrl}/api/system/project-path/inspect`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.body).toBe(JSON.stringify({ path: "/tmp/manual-project" }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("persists the session token after login and forwards it on later requests", async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          authenticated: true,
          createdUser: true,
          sessionToken: "session-token",
          session: { id: "session_1", expiresAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" },
          user: { id: "user_1", handle: "alice", displayName: "Alice", isAdmin: false, createdAt: "2026-01-01T00:00:00.000Z" },
          memberships: [],
        }), { status: 200, headers: { "content-type": "application/json" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          snapshot: createDefaultWorkspaceSnapshot(),
          globalConfig: createDefaultGlobalWorkspaceConfig(),
          auth: { required: true, authenticated: true, createdUser: false, session: { id: "session_1", expiresAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z" }, user: { id: "user_1", handle: "alice", displayName: "Alice", isAdmin: false, createdAt: "2026-01-01T00:00:00.000Z" }, memberships: [] },
        }), { status: 200, headers: { "content-type": "application/json" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WorkspaceRuntimeClient();

    await client.login({ handle: "alice", password: "secret-pass", displayName: "Alice" });
    await client.getState();

    expect(client.getSessionToken()).toBe("session-token");
    const stateCall = fetchMock.mock.calls[1];
    expect(stateCall).toBeDefined();
    const [, init] = stateCall as unknown as [string, RequestInit];
    expect(new Headers(init.headers).get("x-openaquarium-session")).toBe("session-token");
    expect(init.credentials).toBe("include");
  });

  it("builds chat transport requests with the current session token and credentialed cookies", async () => {
    const storage = new Map<string, string>([["oa.sessionToken", "session-token"]]);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response("data: {\"type\":\"finish\",\"finishReason\":\"stop\"}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = new DefaultChatTransport({
      api: "http://127.0.0.1:4301/api/chat",
      credentials: resolveWorkspaceRuntimeRequestCredentials(),
      headers: () => resolveWorkspaceRuntimeRequestHeaders(),
    });

    await transport.sendMessages({
      chatId: "room-chat-test",
      trigger: "submit-message",
      messageId: undefined,
      abortSignal: undefined,
      headers: undefined,
      metadata: undefined,
      body: {
        roomId: "room_1",
      },
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "ping" }],
        },
      ],
    });

    const transportCall = fetchMock.mock.calls[0];
    expect(transportCall).toBeDefined();
    const [url, init] = transportCall as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4301/api/chat");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("x-openaquarium-session")).toBe("session-token");
  });

  it("connects the websocket with the current session token and forwards auth payloads", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>([["oa.sessionToken", "session-token"]]);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
    const { sockets, webSocketConstructor } = installWebSocketMock();

    const onRemoteState = vi.fn();
    const onConnectionChange = vi.fn();
    const client = new WorkspaceRuntimeClient();

    const disconnect = client.connect(onRemoteState, onConnectionChange);
    await vi.runAllTimersAsync();

    expect(webSocketConstructor).toHaveBeenCalledWith(`${client.baseUrl.replace("http", "ws")}/ws?sessionToken=session-token`);
    expect(sockets).toHaveLength(1);

    sockets[0]?.trigger("message", {
      data: JSON.stringify({
        type: "snapshot",
        snapshot: createDefaultWorkspaceSnapshot(),
        auth: {
          required: true,
          authenticated: true,
          createdUser: false,
          session: {
            id: "session_1",
            expiresAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
          user: {
            id: "user_1",
            handle: "alice",
            displayName: "Alice",
            isAdmin: false,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          memberships: [],
        },
      }),
    });

    expect(onRemoteState.mock.calls[0]?.[0]).toMatchObject({
      auth: {
        authenticated: true,
        sessionToken: "session-token",
      },
    });

    disconnect();
    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("keeps websocket auth snapshots scoped to the token captured when the connection starts", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
    const { sockets, webSocketConstructor } = installWebSocketMock();

    const onRemoteState = vi.fn();
    const onConnectionChange = vi.fn();
    const client = new WorkspaceRuntimeClient();

    const disconnectBeforeLogin = client.connect(onRemoteState, onConnectionChange);
    await vi.runAllTimersAsync();

    (client as unknown as { persistSessionToken(sessionToken?: string): void }).persistSessionToken("session-token");
    const disconnectAfterLogin = client.connect(onRemoteState, onConnectionChange);
    await vi.runAllTimersAsync();

    expect(webSocketConstructor.mock.calls).toEqual([
      [`${client.baseUrl.replace("http", "ws")}/ws`],
      [`${client.baseUrl.replace("http", "ws")}/ws?sessionToken=session-token`],
    ]);
    expect(sockets).toHaveLength(2);

    sockets[0]?.trigger("open");
    sockets[0]?.trigger("close");
    expect(onConnectionChange).not.toHaveBeenCalled();

    sockets[1]?.trigger("open");
    expect(onConnectionChange).toHaveBeenCalledWith(true);

    sockets[0]?.trigger("message", {
      data: JSON.stringify({
        type: "snapshot",
        snapshot: createDefaultWorkspaceSnapshot(),
        auth: {
          required: true,
          authenticated: false,
        },
      }),
    });
    expect(onRemoteState).not.toHaveBeenCalled();

    sockets[1]?.trigger("message", {
      data: JSON.stringify({
        type: "snapshot",
        snapshot: createDefaultWorkspaceSnapshot(),
        auth: {
          required: true,
          authenticated: true,
          createdUser: false,
          session: {
            id: "session_1",
            expiresAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
          user: {
            id: "user_1",
            handle: "alice",
            displayName: "Alice",
            isAdmin: false,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          memberships: [],
        },
      }),
    });

    expect(onRemoteState).toHaveBeenCalledTimes(1);
    expect(onRemoteState.mock.calls[0]?.[0]).toMatchObject({
      auth: {
        authenticated: true,
        sessionToken: "session-token",
      },
    });

    disconnectBeforeLogin();
    disconnectAfterLogin();
  });


  it("ignores stale websocket events after reconnecting with the same session token", async () => {
    vi.useFakeTimers();
    const storage = new Map<string, string>([["oa.sessionToken", "session-token"]]);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
    const { sockets, webSocketConstructor } = installWebSocketMock();

    const onRemoteState = vi.fn();
    const onConnectionChange = vi.fn();
    const client = new WorkspaceRuntimeClient();

    const disconnectFirst = client.connect(onRemoteState, onConnectionChange);
    await vi.runAllTimersAsync();

    const disconnectSecond = client.connect(onRemoteState, onConnectionChange);
    await vi.runAllTimersAsync();

    expect(webSocketConstructor.mock.calls).toEqual([
      [`${client.baseUrl.replace("http", "ws")}/ws?sessionToken=session-token`],
      [`${client.baseUrl.replace("http", "ws")}/ws?sessionToken=session-token`],
    ]);
    expect(sockets).toHaveLength(2);

    sockets[0]?.trigger("open");
    sockets[0]?.trigger("message", {
      data: JSON.stringify({
        type: "snapshot",
        snapshot: createDefaultWorkspaceSnapshot(),
        auth: {
          required: true,
          authenticated: true,
          createdUser: false,
          session: {
            id: "session_old",
            expiresAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
          user: {
            id: "user_old",
            handle: "old",
            displayName: "Old",
            isAdmin: false,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          memberships: [],
        },
      }),
    });
    sockets[0]?.trigger("close");

    expect(onConnectionChange).not.toHaveBeenCalled();
    expect(onRemoteState).not.toHaveBeenCalled();

    sockets[1]?.trigger("open");
    sockets[1]?.trigger("message", {
      data: JSON.stringify({
        type: "snapshot",
        snapshot: createDefaultWorkspaceSnapshot(),
        auth: {
          required: true,
          authenticated: true,
          createdUser: false,
          session: {
            id: "session_current",
            expiresAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-01T00:00:00.000Z",
          },
          user: {
            id: "user_current",
            handle: "alice",
            displayName: "Alice",
            isAdmin: false,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          memberships: [],
        },
      }),
    });

    expect(onConnectionChange).toHaveBeenCalledTimes(1);
    expect(onConnectionChange).toHaveBeenCalledWith(true);
    expect(onRemoteState).toHaveBeenCalledTimes(1);
    expect(onRemoteState.mock.calls[0]?.[0]).toMatchObject({
      auth: {
        authenticated: true,
        user: {
          handle: "alice",
        },
      },
    });

    disconnectFirst();
    disconnectSecond();
  });
});
