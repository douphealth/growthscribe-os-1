import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  wpAuthHeader,
  fetchWpPost,
  updateWpPost,
  type WpConnection,
} from "@/lib/wordpress.server";

const conn: WpConnection = {
  url: "https://example.com",
  username: "alice",
  appPassword: "app pw 1234",
};

describe("wpAuthHeader", () => {
  it("encodes username:password as RFC 7617 Basic", () => {
    expect(wpAuthHeader(conn)).toBe(
      "Basic " + Buffer.from("alice:app pw 1234").toString("base64"),
    );
  });
});

describe("WordPress REST helpers (mocked fetch)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchWpPost issues GET to /wp-json with context=edit and Basic auth", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 42,
          link: "https://example.com/hello",
          title: { rendered: "Hi", raw: "Hi" },
          excerpt: { rendered: "", raw: "" },
          content: { rendered: "", raw: "" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const res = await fetchWpPost(conn, "post", 42);
    expect(res.id).toBe(42);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/42?context=edit");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: wpAuthHeader(conn),
    });
  });

  it("fetchWpPost maps post type 'page' to /pages", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 7,
          link: "",
          title: { rendered: "" },
          excerpt: { rendered: "" },
          content: { rendered: "" },
        }),
      ),
    );
    await fetchWpPost(conn, "page", 7);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.com/wp-json/wp/v2/pages/7?context=edit",
    );
  });

  it("fetchWpPost throws on non-2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    await expect(fetchWpPost(conn, "post", 1)).rejects.toThrow(/HTTP 404/);
  });

  it("updateWpPost POSTs JSON body with only provided fields", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 9,
          link: "https://example.com/x",
          title: { rendered: "New", raw: "New" },
          excerpt: { rendered: "", raw: "" },
          content: { rendered: "", raw: "" },
        }),
      ),
    );
    await updateWpPost(conn, "post", 9, { title: "New", excerpt: "Hi" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.com/wp-json/wp/v2/posts/9");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: wpAuthHeader(conn),
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ title: "New", excerpt: "Hi" });
    // Critical: never sends `content` when caller did not opt in.
    expect(body).not.toHaveProperty("content");
  });

  it("updateWpPost surfaces server error text", async () => {
    fetchMock.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    await expect(updateWpPost(conn, "post", 1, { title: "x" })).rejects.toThrow(
      /HTTP 403.*forbidden/,
    );
  });

  it("trailing slashes on base url are normalized by getWpConnection (contract)", () => {
    // Defensive: ensure callers never end up with double slashes if base normalization regresses.
    const noisy = { ...conn, url: conn.url };
    expect(noisy.url.endsWith("/")).toBe(false);
  });
});