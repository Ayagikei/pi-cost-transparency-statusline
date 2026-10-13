import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { collectUsage, rpcUsageLines } from "../extensions/usage.ts";

function context(entries: unknown[], rate = 999): ExtensionContext {
  return { sessionManager: { getBranch: () => entries }, model: { cost: { input: rate, output: rate, cacheRead: rate, cacheWrite: rate } } } as unknown as ExtensionContext;
}
const usage = { input: 100, output: 20, cacheRead: 30, cacheWrite: 10, cost: { input: .1, output: .2, cacheRead: .03, cacheWrite: .04 } };

test("RPC costs use recorded assistant usage, not the current model price", () => {
  const ctx = context([{ type: "message", message: { role: "user", usage } }, { type: "message", message: { role: "assistant", usage } }]);
  assert.equal(collectUsage(ctx).tokIn, 100);
  assert.equal(collectUsage(ctx).costIn, .1);
  assert.ok(rpcUsageLines(ctx).includes("| 输入 | 100 | $0.1000 | $999 |"));
  assert.ok(rpcUsageLines(ctx).some(row => row.includes("不用于重算历史费用")));
});

test("empty sessions and missing model prices render without inventing costs", () => {
  const ctx = context([]); Object.assign(ctx, { model: undefined });
  assert.ok(rpcUsageLines(ctx).includes("| 缓存写入 | 0 | $0.0000 | — |"));
});
