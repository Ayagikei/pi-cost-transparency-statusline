import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";

// Pi 1.1 core/cache-stats.js is not a public export. Keep these rules aligned
// with it (MIT, Earendil Works), without depending on private package paths.
// This structural history type also accepts older Pi versions without UsageEntry.
type HistoryEntry = {
	type: string;
	timestamp: string;
	kind?: string;
	provider?: string;
	model?: string;
	usage?: Usage;
	message?: {
		role: string;
		timestamp?: number;
		provider?: string;
		model?: string;
		usage?: Usage;
	};
};

type PreviousRequest = {
	promptTokens: number;
	timestamp: number;
	modelKey: string;
	reportedCache: boolean;
};

type FindModel = (provider: string, model: string) =>
	| { cost: { cacheRead: number } }
	| undefined;

const CACHE_TTL_MS = 5 * 60 * 1000;
const NOISE_FLOOR_TOKENS = 1024;

export function cacheMissNotice(
	entries: readonly HistoryEntry[],
	message: AssistantMessage,
	findModel: FindModel,
): string | undefined {
	let previous: PreviousRequest | undefined;
	for (const entry of entries) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			previous = undefined;
		} else if (entry.type === "usage" && entry.kind === "cache_warm" && entry.usage) {
			const promptTokens = entry.usage.input + entry.usage.cacheRead + entry.usage.cacheWrite;
			if (promptTokens > 0) {
				previous = {
					promptTokens,
					timestamp: Date.parse(entry.timestamp),
					modelKey: `${entry.provider}/${entry.model}`,
					reportedCache: true,
				};
			}
		} else if (entry.type === "message" && entry.message?.role === "assistant" && entry.message.usage) {
			const { usage } = entry.message;
			const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
			if (promptTokens > 0) {
				previous = {
					promptTokens,
					timestamp: entry.message.timestamp!,
					modelKey: `${entry.message.provider}/${entry.message.model}`,
					reportedCache: Boolean(previous?.reportedCache) || usage.cacheRead + usage.cacheWrite > 0,
				};
			}
		}
	}

	const { usage } = message;
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	if (!previous || promptTokens <= 0 || (usage.cacheRead + usage.cacheWrite === 0 && !previous.reportedCache)) return;
	const missedTokens = Math.min(previous.promptTokens, promptTokens) - usage.cacheRead;
	if (missedTokens <= NOISE_FLOOR_TOKENS) return;

	const paidTokens = usage.input + usage.cacheWrite;
	const paidRate = paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
	const readRate = usage.cacheRead > 0
		? usage.cost.cacheRead / usage.cacheRead
		: (findModel(message.provider, message.model)?.cost.cacheRead ?? 0) / 1_000_000;
	const missedCost = missedTokens * Math.max(0, paidRate - readRate);
	if (missedTokens < 20_000 && missedCost < 0.1) return;

	const idleMs = Math.max(0, message.timestamp - previous.timestamp);
	let label = "Cache miss";
	if (`${message.provider}/${message.model}` !== previous.modelKey) label += " after model switch";
	else if (idleMs >= CACHE_TTL_MS) label += ` after ${Math.round(idleMs / 60_000)}m idle`;
	const tokens = missedTokens >= 1_000_000
		? `${(missedTokens / 1_000_000).toFixed(1)}M`
		: missedTokens >= 1_000 ? `${Math.round(missedTokens / 1_000)}k` : String(missedTokens);
	const cost = missedCost >= 0.01 ? ` (~$${missedCost.toFixed(2)})` : "";
	return `${label}: ${tokens} tokens re-billed${cost}`;
}
