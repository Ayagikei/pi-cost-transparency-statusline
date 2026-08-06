/**
 * Rich Status Line Extension - Pastel Edition
 *
 * Friendly pastel palette designed for dark terminal backgrounds.
 *
 * Line 1:  ~/path/to/cwd ⎇ git-branch ┄┄┄┄┄┄┄┄┄ ◈ model · thinking
 * Line 2:  ▲ Input  ┊  ▼ Output  ┊  ◆ Cache read  ┊  ◆ Cache write [5m/1h]  ┊  ✦ Cache hit
 * Line 3:  Nk       ┊  Nk        ┊  Nk            ┊  Nk             ┊  XX.X%
 * Line 4:  $X.XXXX  ┊  $X.XXXX   ┊  $X.XXXX       ┊  $X.XXXX        ┊  ├━━━━━━──┤
 * Line 5:  Context N ⁄ N ├━─────────┤ XX.X%          ∑ Est. total $X.XXXX
 */

import { calculateCost, type Api, type Model, type Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

// ── 24-bit ANSI colour helper ───────────────────────────────────────────────
const rgb =
	(r: number, g: number, b: number) =>
	(text: string): string =>
		`\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;

// ── Palette ─────────────────────────────────────────────────────────────────
const c = {
	// Navigation (line 1)
	cwd: rgb(137, 207, 240), // pastel sky blue    ~/path
	branch: rgb(255, 190, 152), // soft peach         (branch)
	model: rgb(184, 192, 255), // pastel periwinkle  model name
	thinking: rgb(255, 226, 138), // soft sunshine      (thinking level)

	// Labels - muted lavender lets the values stand out
	label: rgb(170, 166, 194),

	// Token counts (line 2)
	tokIn: rgb(168, 230, 163), // pastel green   ↑ Input
	tokOut: rgb(255, 154, 162), // pastel red     ↓ Output
	tokCacheR: rgb(255, 191, 138), // pastel orange  CacheRead
	tokCacheW: rgb(255, 191, 138), // pastel orange  CacheWrite
	cacheHit: rgb(255, 191, 138), // pastel orange  CacheHit %
	context: rgb(195, 177, 225), // soft lavender  Context tokens
	contextEmpty: rgb(69, 65, 84), // muted plum     Context bar empty
	contextText: rgb(231, 220, 255), // pale lavender  Context percentage

	// Cost breakdown (line 3)
	costIn: rgb(168, 230, 163), // pastel green   $Input
	costOut: rgb(255, 154, 162), // pastel red     $Output
	costCacheR: rgb(255, 191, 138), // pastel orange  $CacheRead
	costCacheW: rgb(255, 191, 138), // pastel orange  $CacheWrite
	costTotal: rgb(152, 228, 198), // pastel mint    Total

	// Structural
	sep: rgb(80, 76, 96), // muted plum separator
	divider: rgb(143, 137, 166), // soft lavender divider
};

const MODEL_COLUMN = 80;

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWrite1h: number;
	costInput: number;
	costOutput: number;
	costCacheRead: number;
	costCacheWrite: number;
	costTotal: number;
}

function createUsageTotals(): UsageTotals {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cacheWrite1h: 0,
		costInput: 0,
		costOutput: 0,
		costCacheRead: 0,
		costCacheWrite: 0,
		costTotal: 0,
	};
}

function addUsageToTotals(totals: UsageTotals, usage: Usage, cost = usage.cost): void {
	totals.input += usage.input;
	totals.output += usage.output;
	totals.cacheRead += usage.cacheRead;
	totals.cacheWrite += usage.cacheWrite;
	totals.cacheWrite1h += usage.cacheWrite1h ?? 0;
	totals.costInput += cost.input;
	totals.costOutput += cost.output;
	totals.costCacheRead += cost.cacheRead;
	totals.costCacheWrite += cost.cacheWrite;
	totals.costTotal += cost.total;
}

function getCurrentCopilotCost(usage: Usage, model: Model<Api> | undefined): Usage["cost"] {
	if (model?.provider !== "github-copilot") return usage.cost;

	// Recalculate against Pi's current Copilot catalog instead of trusting a
	// persisted Usage.cost value. This keeps the live display correct when the
	// catalog changes during a session and preserves Pi's cacheWrite1h logic.
	const currentUsage: Usage = {
		...usage,
		cost: { ...usage.cost },
	};
	return calculateCost(model, currentUsage);
}

// ── Extension ───────────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
	let requestRender: (() => void) | undefined;

	pi.on("session_start", async (_event, ctx) => {
		// Pi normally refreshes remote catalogs on startup. Refresh again in the
		// background for Copilot so the live estimate can use current rates without
		// making the footer render path network-dependent.
		if (ctx.model?.provider === "github-copilot") {
			void ctx.modelRegistry.refresh().then(() => requestRender?.()).catch(() => undefined);
		}

		const home = homedir();

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose() {
					requestRender = undefined;
					unsubBranch();
				},
				invalidate() {},
				render(width: number): string[] {
					// Match Pi's own session totals: include all entries, including
					// nested tool usage and compaction/branch-summary generation.
					const usageTotals = createUsageTotals();
					const activeModel = ctx.model as Model<Api> | undefined;
					const currentModel = activeModel
						? ((ctx.modelRegistry.find(activeModel.provider, activeModel.id) as Model<Api> | undefined) ?? activeModel)
						: undefined;
					for (const e of ctx.sessionManager.getEntries()) {
						let usage: Usage | undefined;
						let usageModel: Model<Api> | undefined;
						if (e.type === "message") {
							if (e.message.role === "assistant") {
								usage = e.message.usage;
								usageModel = ctx.modelRegistry.find(
									e.message.provider,
									e.message.responseModel ?? e.message.model,
								) as Model<Api> | undefined;
							} else if (e.message.role === "toolResult") {
								usage = e.message.usage;
								usageModel = currentModel;
							}
						} else if ((e.type === "compaction" || e.type === "branch_summary") && e.usage) {
							usage = e.usage;
							usageModel = currentModel;
						}
						if (usage) {
							addUsageToTotals(usageTotals, usage, getCurrentCopilotCost(usage, usageModel));
						}
					}

					const tokIn = usageTotals.input;
					const tokOut = usageTotals.output;
					const tokCacheRead = usageTotals.cacheRead;
					const tokCacheWrite = usageTotals.cacheWrite;
					const tokCacheWrite1h = usageTotals.cacheWrite1h;
					const costIn = usageTotals.costInput;
					const costOut = usageTotals.costOutput;
					const costCacheRead = usageTotals.costCacheRead;
					const costCacheWrite = usageTotals.costCacheWrite;
					const costTotal = usageTotals.costTotal;

					// ── Formatters ───────────────────────────────────────────────
					const fmtTok = (n: number): string => {
						if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
						if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
						return `${n}`;
					};
					const fmtTokExact = (n: number): string => n.toLocaleString("en-US");
					const fmtUsd = (n: number): string => `$${n.toFixed(4)}`;

					// ── Derived stats ────────────────────────────────────────────
					const cacheWriteSupported = tokCacheWrite > 0 || (currentModel?.cost.cacheWrite ?? 0) > 0;
					const cacheWriteMode =
						tokCacheWrite1h > 0
							? tokCacheWrite1h === tokCacheWrite
								? " 1h"
								: " mixed"
							: "";
					const cacheWriteLabel = `Cache write${cacheWriteMode}`;
					const cacheWriteDisplay = cacheWriteSupported ? fmtTok(tokCacheWrite) : "n/a";
					const cacheWriteCostDisplay = cacheWriteSupported ? fmtUsd(costCacheWrite) : "n/a";
					const totalInTokens = tokIn + tokCacheRead + tokCacheWrite;
					const cacheHitPct =
						totalInTokens > 0
							? ((tokCacheRead / totalInTokens) * 100).toFixed(1)
							: "0.0";

					const progressRail = (
						percent: number,
						fillColor: (text: string) => string,
						railWidth = 18,
					): string => {
						const pct = Math.max(0, Math.min(100, percent || 0));
						const filled = Math.round((pct / 100) * railWidth);
						return (
							c.sep("├") +
							fillColor("━".repeat(filled)) +
							c.contextEmpty("─".repeat(railWidth - filled)) +
							c.sep("┤")
						);
					};

					const ctxUsage = ctx.getContextUsage();
					const contextProgress = (tokens: number, contextWindow: number, percent: number): string => {
						const pct = Math.max(0, Math.min(100, percent || 0));
						const fillColor =
							pct >= 90
								? c.tokOut
								: pct >= 75
									? c.tokCacheW
									: pct >= 55
										? c.thinking
										: c.cwd;
						return `${c.context(fmtTokExact(tokens))}${c.label("/")}${c.context(fmtTokExact(contextWindow))} tok ${progressRail(pct, fillColor)} ${c.contextText(`${pct.toFixed(1)}%`)}`;
					};
					// Pi reports an unknown token count while compaction is in progress.
					const ctxStr =
						ctxUsage?.tokens != null && ctxUsage.percent != null
							? contextProgress(ctxUsage.tokens, ctxUsage.contextWindow, ctxUsage.percent)
							: null;

					const thinkingLabels: Record<string, string> = {
						off: "off",
						minimal: "minimal",
						low: "low",
						medium: "medium",
						high: "high",
						xhigh: "x-high",
					};
					const thinking = thinkingLabels[pi.getThinkingLevel()] ?? pi.getThinkingLevel();

					const modelId = ctx.model?.id ?? "no model";
					const modelShort = modelId.includes("/") ? modelId.split("/").pop()! : modelId;

					// ── Helpers ──────────────────────────────────────────────────
					const SEP = c.sep("  ┊  ");

					// ── Line 1: path  (branch)  ·····  Model: model  (thinking) ──
					const cwd = ctx.cwd.startsWith(home) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;
					const branch = footerData.getGitBranch();
					const left1 = c.cwd(cwd) + (branch ? "  " + c.branch(`⎇ ${branch}`) : "");
					const fixedLeft1 = truncateToWidth(left1, MODEL_COLUMN - 2, "");
					const leader1 = c.sep(
						" " + "┄".repeat(Math.max(1, MODEL_COLUMN - visibleWidth(fixedLeft1) - 2)) + " ",
					);
					const model1 = c.model(`◈ ${modelShort}`) + c.label(" · ") + c.thinking(thinking);

					// Telemetry columns: header printed once, tokens and cost stacked below.
					const hitRatio = totalInTokens > 0 ? tokCacheRead / totalInTokens : 0;
					const hitGauge = progressRail(hitRatio * 100, c.cacheHit, 10);

					const columns = [
						{
							header: c.tokIn("▲ ") + c.label("Input"),
							headerWidth: visibleWidth("▲ Input"),
							tokens: c.tokIn(fmtTok(tokIn)),
							cost: c.costIn(fmtUsd(costIn)),
						},
						{
							header: c.tokOut("▼ ") + c.label("Output"),
							headerWidth: visibleWidth("▼ Output"),
							tokens: c.tokOut(fmtTok(tokOut)),
							cost: c.costOut(fmtUsd(costOut)),
						},
						{
							header: c.tokCacheR("◆ ") + c.label("Cache read"),
							headerWidth: visibleWidth("◆ Cache read"),
							tokens: c.tokCacheR(fmtTok(tokCacheRead)),
							cost: c.costCacheR(fmtUsd(costCacheRead)),
						},
						{
							header: c.tokCacheW("◆ ") + c.label(cacheWriteLabel),
							headerWidth: visibleWidth(`◆ ${cacheWriteLabel}`),
							tokens: c.tokCacheW(cacheWriteDisplay),
							cost: c.costCacheW(cacheWriteCostDisplay),
						},
						{
							header: c.cacheHit("✦ ") + c.label("Cache hit"),
							headerWidth: visibleWidth("✦ Cache hit"),
							tokens: c.cacheHit(`${cacheHitPct}%`),
							cost: hitGauge,
						},
					];
					const cells = columns.map((col) => {
						const colWidth = Math.max(col.headerWidth, visibleWidth(col.tokens), visibleWidth(col.cost));
						const pad = (cell: string) => cell + " ".repeat(colWidth - visibleWidth(cell));
						return {
							header: pad(col.header),
							tokens: pad(col.tokens),
							cost: pad(col.cost),
						};
					});

					// Lines 2-4: column headers, token row, cost row.
					const line2 = cells.map((cell) => cell.header).join(SEP);
					const line3 = cells.map((cell) => cell.tokens).join(SEP);
					const line4 = cells.map((cell) => cell.cost).join(SEP);

					// ── Line 5: context gauge ····· ∑ EST. TOTAL right-aligned ─────
					const left5 = c.label("Context ") + (ctxStr ?? c.context("n/a"));
					// Pi stores model-catalog estimates, not provider invoices.
					const total5 = c.costTotal("∑ ") + c.label("Est. total ") + c.costTotal(fmtUsd(costTotal));
					const gap5 = " ".repeat(Math.max(2, width - visibleWidth(left5) - visibleWidth(total5)));

					return [
						truncateToWidth(fixedLeft1 + leader1 + model1, width),
						truncateToWidth(line2, width),
						truncateToWidth(line3, width),
						truncateToWidth(line4, width),
						truncateToWidth(left5 + gap5 + total5, width),
					];
				},
			};
		});
	});

	pi.on("turn_end", async () => {
		requestRender?.();
	});
	pi.on("session_compact", async () => {
		requestRender?.();
	});
	pi.on("model_select", async () => {
		requestRender?.();
	});
	pi.on("thinking_level_select", async () => {
		requestRender?.();
	});
}
