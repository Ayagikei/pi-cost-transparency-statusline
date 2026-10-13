import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function collectUsage(ctx: ExtensionContext) {
	let tokIn = 0, tokOut = 0, tokCacheRead = 0, tokCacheWrite = 0;
	let costIn = 0, costOut = 0, costCacheRead = 0, costCacheWrite = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const { usage } = entry.message;
		tokIn += usage.input; tokOut += usage.output;
		tokCacheRead += usage.cacheRead; tokCacheWrite += usage.cacheWrite;
		costIn += usage.cost.input; costOut += usage.cost.output;
		costCacheRead += usage.cost.cacheRead; costCacheWrite += usage.cost.cacheWrite;
	}
	return { tokIn, tokOut, tokCacheRead, tokCacheWrite, costIn, costOut, costCacheRead, costCacheWrite };
}

export function rpcUsageLines(ctx: ExtensionContext): string[] {
	const usage = collectUsage(ctx);
	const rows = [
		["输入", usage.tokIn, usage.costIn, ctx.model?.cost.input],
		["输出", usage.tokOut, usage.costOut, ctx.model?.cost.output],
		["缓存读取", usage.tokCacheRead, usage.costCacheRead, ctx.model?.cost.cacheRead],
		["缓存写入", usage.tokCacheWrite, usage.costCacheWrite, ctx.model?.cost.cacheWrite],
	] as const;
	return ["| 类型 | token | 费用 USD | 当前单价 USD / 1M |", "| --- | ---: | ---: | ---: |", ...rows.map(([name, tokens, cost, rate]) => `| ${name} | ${tokens.toLocaleString("en-US")} | $${cost.toFixed(4)} | ${rate === undefined ? "—" : `$${rate}`} |`), "", "历史费用来自 Pi 会话记录；当前单价不用于重算历史费用。"];
}
