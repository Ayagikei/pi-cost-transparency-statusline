import test from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { cacheMissNotice } from "../extensions/cache-miss.ts";
import statusline from "../extensions/statusline.ts";

const now = Date.parse("2026-10-13T12:00:00Z");
const pricing = () => ({ cost: { cacheRead: 0.1 } });
function message(usage: Partial<Usage> = {}, timestamp = now): AssistantMessage {
	return {
		role: "assistant", content: [], api: "openai-completions", provider: "fixture", model: "cached",
		timestamp, stopReason: "stop",
		usage: { input: 138_000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 138_010,
			cost: { input: 0.276, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.277 }, ...usage },
	};
}
function history(previous = message({ input: 0, cacheRead: 138_000 }, now - 99 * 60_000)) {
	return [{ type: "message", timestamp: new Date(previous.timestamp).toISOString(), message: previous }];
}

test("idle total miss uses real per-message costs and does not change usage", () => {
	const current = message();
	const original = structuredClone(current);
	assert.equal(cacheMissNotice(history(), current, pricing), "Cache miss after 99m idle: 138k tokens re-billed (~$0.26)");
	assert.deepEqual(current, original);
});

test("first request and providers that have never reported caching have no notice", () => {
	assert.equal(cacheMissNotice([], message(), pricing), undefined);
	assert.equal(cacheMissNotice(history(message({}, now - 99 * 60_000)), message(), pricing), undefined);
});

test("partial cache miss uses actual cache-read price rather than current model price", () => {
	const current = message({ input: 30_000, cacheRead: 108_000,
		cost: { input: .06, output: 0, cacheRead: .0108, cacheWrite: 0, total: .0708 } });
	assert.equal(cacheMissNotice(history(), current, () => ({ cost: { cacheRead: 999 } })),
		"Cache miss after 99m idle: 30k tokens re-billed (~$0.06)");
});

test("full hit, breakpoint noise and misses below the display threshold stay quiet", () => {
	for (const input of [0, 1024, 19999]) {
		const current = message({ input, cacheRead: 138_000 - input,
			cost: { input: input * .000002, output: 0, cacheRead: (138_000 - input) * .0000001, cacheWrite: 0, total: 0 } });
		assert.equal(cacheMissNotice(history(), current, pricing), undefined);
	}
});

test("cost threshold can show fewer than 20k missed tokens", () => {
	const current = message({ input: 10_000, cacheRead: 128_000,
		cost: { input: .2, output: 0, cacheRead: .0128, cacheWrite: 0, total: .2128 } });
	assert.equal(cacheMissNotice(history(), current, pricing), "Cache miss after 99m idle: 10k tokens re-billed (~$0.20)");
});

test("compaction and branch summaries reset the previous prompt", () => {
	for (const type of ["compaction", "branch_summary"]) {
		const entries = [...history(), { type, timestamp: new Date(now).toISOString() }];
		assert.equal(cacheMissNotice(entries, message(), pricing), undefined);
	}
});

test("cache warming refreshes the reference request and idle clock", () => {
	const entries = [...history(), { type: "usage", kind: "cache_warm", provider: "fixture", model: "cached",
		timestamp: new Date(now - 60_000).toISOString(), usage: message({ input: 0, cacheRead: 138_000 }).usage }];
	assert.equal(cacheMissNotice(entries, message(), pricing), "Cache miss: 138k tokens re-billed (~$0.26)");
});

test("model switch takes precedence over idle wording", () => {
	assert.equal(cacheMissNotice(history(), { ...message(), model: "different" }, pricing),
		"Cache miss after model switch: 138k tokens re-billed (~$0.26)");
});

test("cache-write premium is counted and already-paid usage is not re-added", () => {
	const current = message({ input: 0, cacheWrite: 138_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: .345, total: .345 } });
	assert.equal(cacheMissNotice(history(), current, pricing), "Cache miss after 99m idle: 138k tokens re-billed (~$0.33)");
	assert.equal(current.usage.cost.total, .345);
});

test("unknown pricing omits the dollar amount; zero-usage replies do not reset the baseline", () => {
	const current = message({ cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
	assert.equal(cacheMissNotice(history(), current, () => undefined), "Cache miss after 99m idle: 138k tokens re-billed");
	assert.equal(cacheMissNotice([...history(), ...history(message({ input: 0 }, now - 60_000))], message(), pricing),
		"Cache miss after 99m idle: 138k tokens re-billed (~$0.26)");
});

test("statusline emits exactly one RPC warning, not TUI or history-reload notifications", async () => {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	statusline({ on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => handlers.set(name, handler) } as unknown as ExtensionAPI);
	const notices: unknown[] = [];
	const ctx = { mode: "rpc", sessionManager: { getBranch: () => history() }, modelRegistry: { find: pricing },
		ui: { notify: (...args: unknown[]) => notices.push(args), setWidget: () => {} } } as unknown as ExtensionContext;
	await handlers.get("session_start")!({}, ctx);
	assert.equal(notices.length, 0);
	await handlers.get("message_end")!({ message: message() }, ctx);
	assert.deepEqual(notices, [["Cache miss after 99m idle: 138k tokens re-billed (~$0.26)", "warning"]]);
	await handlers.get("message_end")!({ message: { role: "user" } }, ctx);
	await handlers.get("message_end")!({ message: message() }, { ...ctx, mode: "tui" });
	assert.equal(notices.length, 1);
});
