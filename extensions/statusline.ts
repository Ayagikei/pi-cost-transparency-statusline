/**
 * Rich Status Line Extension - Pastel Edition
 *
 * Friendly pastel palette designed for dark terminal backgrounds.
 *
 * Line 1:  ~/path/to/cwd (git-branch)          Model: model (thinking)
 * Line 2:  ↑ Input: Nk  ↓ Output: Nk    CacheRead: Nk    CacheWrite: Nk  CacheHit: XX.X%
 * Line 3:  $ Input: X.XXXX  $ Output: X.XXXX  $ CacheRead: X.XXXX  $ CacheWrite: X.XXXX
 * Line 4:  ── Total: $X.XXXX  Context: N/N tokens  🌈progress XX.X%
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
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

// ── Extension ───────────────────────────────────────────────────────────────
export default function (pi: ExtensionAPI) {
	let requestRender: (() => void) | undefined;

	pi.on("session_start", async (_event, ctx) => {
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
					// ── Accumulate stats ─────────────────────────────────────────
					let tokIn = 0,
						tokOut = 0,
						tokCacheRead = 0,
						tokCacheWrite = 0;
					let costIn = 0,
						costOut = 0,
						costCacheRead = 0,
						costCacheWrite = 0;

					for (const e of ctx.sessionManager.getBranch()) {
						if (e.type === "message" && e.message.role === "assistant") {
							const m = e.message as AssistantMessage;
							tokIn += m.usage.input;
							tokOut += m.usage.output;
							tokCacheRead += m.usage.cacheRead;
							tokCacheWrite += m.usage.cacheWrite;
							costIn += m.usage.cost.input;
							costOut += m.usage.cost.output;
							costCacheRead += m.usage.cost.cacheRead;
							costCacheWrite += m.usage.cost.cacheWrite;
						}
					}

					const costTotal = costIn + costOut + costCacheRead + costCacheWrite;

					// ── Formatters ───────────────────────────────────────────────
					const fmtTok = (n: number): string => {
						if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
						if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
						return `${n}`;
					};
					const fmtTokExact = (n: number): string => n.toLocaleString("en-US");
					const fmtUsd = (n: number): string => `$${n.toFixed(4)}`;

					// ── Derived stats ────────────────────────────────────────────
					const cacheWriteSupported = tokCacheWrite > 0 || (ctx.model?.cost.cacheWrite ?? 0) > 0;
					const cacheWriteDisplay = cacheWriteSupported ? fmtTok(tokCacheWrite) : "n/a";
					const cacheWriteCostDisplay = cacheWriteSupported ? fmtUsd(costCacheWrite) : "n/a";
					const totalInTokens = tokIn + tokCacheRead + tokCacheWrite;
					const cacheHitPct =
						totalInTokens > 0
							? ((tokCacheRead / totalInTokens) * 100).toFixed(1)
							: "0.0";

					const ctxUsage = ctx.getContextUsage();
					const contextProgress = (tokens: number, contextWindow: number, percent: number): string => {
						const pct = Math.max(0, Math.min(100, percent || 0));
						const width = 18;
						const filled = Math.round((pct / 100) * width);
						const dangerTint = pct >= 90 ? 0.85 : pct >= 75 ? 0.55 : pct >= 55 ? 0.25 : 0;
						const rainbow = [
							[137, 207, 240], // sky blue
							[152, 228, 198], // mint
							[168, 230, 163], // green
							[255, 226, 138], // sunshine
							[255, 191, 138], // orange
							[255, 154, 162], // red
						] as const;
						const blendRed = ([r, g, b]: readonly [number, number, number]) =>
							[
								Math.round(r + (255 - r) * dangerTint),
								Math.round(g + (125 - g) * dangerTint),
								Math.round(b + (135 - b) * dangerTint),
							] as const;
						let bar = "";
						for (let i = 0; i < width; i++) {
							if (i < filled) {
								const base = rainbow[Math.min(rainbow.length - 1, Math.floor((i / width) * rainbow.length))]!;
								const [r, g, b] = blendRed(base);
								bar += rgb(r, g, b)("█");
							} else {
								bar += c.contextEmpty("░");
							}
						}
						return `${c.context(fmtTokExact(tokens))}${c.label("/")}${c.context(fmtTokExact(contextWindow))} tok ${c.sep("[")}${bar}${c.sep("]")} ${c.contextText(`${pct.toFixed(1)}%`)}`;
					};
					const ctxStr = ctxUsage
						? contextProgress(ctxUsage.tokens, ctxUsage.contextWindow, ctxUsage.percent ?? 0)
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
					const lbl = (s: string) => c.label(s + ": ");
					const SEP = c.sep("  │  ");

					// ── Line 1: path  (branch)  ·····  Model: model  (thinking) ──
					const cwd = ctx.cwd.startsWith(home) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;
					const branch = footerData.getGitBranch();
					const left1 = c.cwd(cwd) + (branch ? "  " + c.branch(`(${branch})`) : "");
					const fixedLeft1 = truncateToWidth(left1, MODEL_COLUMN - 2, "");
					const model1 = lbl("Model") + c.model(modelShort) + "  " + c.thinking(`(${thinking})`);
					const gap1 = " ".repeat(MODEL_COLUMN - visibleWidth(fixedLeft1));

					// Align each token metric with its matching cost metric below it.
					const metricPairs = [
						{
							tokenLabel: "↑ Input",
							tokenValue: c.tokIn(fmtTok(tokIn)),
							costLabel: "$ Input",
							costValue: c.costIn(fmtUsd(costIn)),
						},
						{
							tokenLabel: "↓ Output",
							tokenValue: c.tokOut(fmtTok(tokOut)),
							costLabel: "$ Output",
							costValue: c.costOut(fmtUsd(costOut)),
						},
						{
							tokenLabel: "  CacheRead",
							tokenValue: c.tokCacheR(fmtTok(tokCacheRead)),
							costLabel: "$ CacheRead",
							costValue: c.costCacheR(fmtUsd(costCacheRead)),
						},
						{
							tokenLabel: "  CacheWrite",
							tokenValue: c.tokCacheW(cacheWriteDisplay),
							costLabel: "$ CacheWrite",
							costValue: c.costCacheW(cacheWriteCostDisplay),
						},
					];
					const alignedMetrics = metricPairs.map((pair) => {
						const tokenLabel = `${pair.tokenLabel}: `;
						const costLabel = `${pair.costLabel}: `;
						const labelWidth = Math.max(visibleWidth(tokenLabel), visibleWidth(costLabel));
						const makeCell = (label: string, value: string) =>
							c.label(label) + " ".repeat(labelWidth - visibleWidth(label)) + value;
						const tokenCell = makeCell(tokenLabel, pair.tokenValue);
						const costCell = makeCell(costLabel, pair.costValue);
						const cellWidth = Math.max(visibleWidth(tokenCell), visibleWidth(costCell));
						const padCell = (cell: string) => cell + " ".repeat(cellWidth - visibleWidth(cell));
						return { token: padCell(tokenCell), cost: padCell(costCell) };
					});

					// ── Line 2: token counts ─────────────────────────────────────
					const line2Parts = [
						...alignedMetrics.map((metric) => metric.token),
						lbl("CacheHit") + c.cacheHit(`${cacheHitPct}%`),
					];

					// ── Line 3: cost breakdown ───────────────────────────────────
					const line3Parts = alignedMetrics.map((metric) => metric.cost);

					// ── Line 4: total cost and context usage ──────────────────────
					const line4 =
						c.divider("──") +
						"  " +
						lbl("Total") +
						c.costTotal(fmtUsd(costTotal)) +
						SEP +
						lbl("Context") +
						(ctxStr ?? c.context("n/a"));

					return [
						truncateToWidth(fixedLeft1 + gap1 + model1, width),
						truncateToWidth(line2Parts.join(SEP), width),
						truncateToWidth(line3Parts.join(SEP), width),
						truncateToWidth(line4, width),
					];
				},
			};
		});
	});

	pi.on("turn_end", async () => {
		requestRender?.();
	});
	pi.on("model_select", async () => {
		requestRender?.();
	});
	pi.on("thinking_level_select", async () => {
		requestRender?.();
	});
}
