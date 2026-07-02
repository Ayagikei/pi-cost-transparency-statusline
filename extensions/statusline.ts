/**
 * Rich Status Line Extension — Neon Edition
 *
 * Colour palette inspired by cyan/amber neon-on-dark aesthetic.
 *
 * Line 1:  ~/path/to/cwd (git-branch)          model (thinking)
 * Line 2:  ↑ Input: Nk  ↓ Output: Nk  CacheRead: Nk  CacheWrite: Nk  CacheHit: XX.X%  Context: N/N tokens  🌈progress XX.X%
 * Line 3:  $Input: X.XXXX  $Output: X.XXXX  $CacheRead: X.XXXX  $CacheWrite: X.XXXX  ── Total: $X.XXXX
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
	cwd: rgb(77, 201, 212), //  soft cyan     ~/path
	branch: rgb(255, 165, 50), //  electric orange  (branch)
	model: rgb(130, 200, 225), //  ice blue      model name
	thinking: rgb(255, 185, 50), //  amber         (thinking level)

	// Labels — dark neutral so values pop
	label: rgb(100, 100, 125), //  slate

	// Token counts (line 2)
	tokIn: rgb(0, 210, 255), //  electric cyan    ↑ Input
	tokOut: rgb(255, 130, 0), //  deep orange      ↓ Output
	tokCacheR: rgb(0, 210, 180), //  teal             CacheRead
	tokCacheW: rgb(255, 200, 0), //  gold             CacheWrite
	cacheHit: rgb(0, 255, 200), //  bright seafoam   CacheHit %
	context: rgb(160, 150, 255), //  periwinkle       Context tokens
	contextEmpty: rgb(38, 38, 52), //  dark graphite   Context bar empty
	contextText: rgb(210, 220, 255), //  pale lavender   Context percentage

	// Cost breakdown (line 3)
	costIn: rgb(255, 100, 90), //  coral            $Input
	costOut: rgb(255, 165, 0), //  orange           $Output
	costCacheR: rgb(0, 200, 175), //  teal             $CacheRead
	costCacheW: rgb(255, 210, 60), //  warm yellow      $CacheWrite
	costTotal: rgb(80, 255, 160), //  electric green   Total

	// Structural
	sep: rgb(55, 55, 75), //  near-black separator
	divider: rgb(90, 90, 115), //  mid-dark ──
};

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
							[0, 220, 255], // cyan
							[0, 255, 170], // mint
							[110, 255, 90], // lime
							[255, 235, 70], // yellow
							[255, 150, 40], // orange
							[255, 70, 70], // red
						] as const;
						const blendRed = ([r, g, b]: readonly [number, number, number]) =>
							[
								Math.round(r + (255 - r) * dangerTint),
								Math.round(g * (1 - dangerTint)),
								Math.round(b * (1 - dangerTint)),
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

					// ── Line 1: path  (branch)  ·····  model  (thinking) ────────
					const cwd = ctx.cwd.startsWith(home) ? `~${ctx.cwd.slice(home.length)}` : ctx.cwd;
					const branch = footerData.getGitBranch();
					const left1 = c.cwd(cwd) + (branch ? "  " + c.branch(`(${branch})`) : "");
					const right1 = c.model(modelShort) + "  " + c.thinking(`(${thinking})`);
					const gap1 = " ".repeat(Math.max(1, width - visibleWidth(left1) - visibleWidth(right1)));

					// ── Line 2: token counts ─────────────────────────────────────
					const line2Parts = [
						lbl("↑ Input") + c.tokIn(fmtTok(tokIn)),
						lbl("↓ Output") + c.tokOut(fmtTok(tokOut)),
						lbl("CacheRead") + c.tokCacheR(fmtTok(tokCacheRead)),
						lbl("CacheWrite") + c.tokCacheW(cacheWriteDisplay),
						lbl("CacheHit") + c.cacheHit(`${cacheHitPct}%`),
						...(ctxStr ? [lbl("Context") + c.context(ctxStr)] : []),
					];

					// ── Line 3: cost breakdown ───────────────────────────────────
					const line3Parts = [
						lbl("$Input") + c.costIn(fmtUsd(costIn)),
						lbl("$Output") + c.costOut(fmtUsd(costOut)),
						lbl("$CacheRead") + c.costCacheR(fmtUsd(costCacheRead)),
						lbl("$CacheWrite") + c.costCacheW(cacheWriteCostDisplay),
						c.divider("──") + "  " + lbl("Total") + c.costTotal(fmtUsd(costTotal)),
					];

					return [
						truncateToWidth(left1 + gap1 + right1, width),
						truncateToWidth(line2Parts.join(SEP), width),
						truncateToWidth(line3Parts.join(SEP), width),
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
