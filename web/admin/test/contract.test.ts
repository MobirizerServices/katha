/** #107 drift gate, client side: every path client.ts actually calls must
 * exist in the server's generated inventory. A renamed or deleted admin-api
 * endpoint fails this test instead of failing an operator at 2am. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_API_PATHS } from "../src/api/paths.generated";

function canonical(methodAndPath: string): string {
  // parameter NAMES don't matter for matching: {user_id} ≡ {slug} ≡ {}
  return methodAndPath.replace(/\{[^}]*\}/g, "{}");
}

const SERVER = new Set(ADMIN_API_PATHS.map(canonical));

function extractClientCalls(src: string): string[] {
  const out: string[] = [];
  // get("/path"...) | get<T>(`/path${x}`...)
  const getRe = /\bget(?:<[^>]*>)?\(\s*(`[^`]+`|"[^"]+")/g;
  // send("/path", "METHOD"...) | send(`/path${x}`, "METHOD"...)
  const sendRe = /\bsend\(\s*(`[^`]+`|"[^"]+")\s*,\s*"(\w+)"/g;
  const norm = (lit: string) =>
    lit.slice(1, -1).replace(/\$\{[^}]*\}/g, "{}").split("?")[0];
  for (const m of src.matchAll(getRe)) out.push(`GET /admin/v1${norm(m[1])}`);
  for (const m of src.matchAll(sendRe)) out.push(`${m[2]} /admin/v1${norm(m[1])}`);
  return out;
}

describe("client ↔ server contract (#107)", () => {
  it("every path the client calls exists on the server", () => {
    const src = readFileSync(
      resolve(__dirname, "../src/api/client.ts"), "utf8");
    const calls = extractClientCalls(src);
    expect(calls.length).toBeGreaterThan(30); // the extractor itself works
    const unknown = calls.filter((c) => !SERVER.has(canonical(c)));
    expect(unknown).toEqual([]);
  });

  it("the generated inventory is present and plausible", () => {
    expect(ADMIN_API_PATHS.length).toBeGreaterThan(40);
    expect(ADMIN_API_PATHS).toContain("POST /admin/v1/wallet/adjust");
  });
});
