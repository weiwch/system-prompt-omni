/**
 * /system-prompt — Display the full system prompt and tool definitions
 * in a full-screen scrollable overlay, with safe prompt-file export.
 *
 * Modified from jandrikus/pi-system-prompt for system-prompt-omni.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type Theme,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  type TUI,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
  getPromptFileContent,
  type PromptFileKind,
} from "../lib/export-content.ts";

type ExportScope = "global" | "project";
type ViewResult = "export" | null;

interface ExportRequest {
  kind?: PromptFileKind;
  scope?: ExportScope;
}

export default function (pi: ExtensionAPI) {
  // Listen for date from pi-today extension.
  let todayDate: string | undefined;
  pi.events.on("today:date", (data: unknown) => {
    if (typeof data === "string") {
      todayDate = data;
    }
  });

  pi.registerCommand("system-prompt", {
    description: "Show or export the current system prompt and tool definitions",
    getArgumentCompletions: (prefix: string) => {
      const choices = [
        { value: "export", label: "export", description: "Open the export wizard" },
        {
          value: "export system global",
          label: "export system global",
          description: "Write global SYSTEM.md",
        },
        {
          value: "export system project",
          label: "export system project",
          description: "Write project .pi/SYSTEM.md",
        },
        {
          value: "export append global",
          label: "export append global",
          description: "Write global APPEND_SYSTEM.md",
        },
        {
          value: "export append project",
          label: "export append project",
          description: "Write project .pi/APPEND_SYSTEM.md",
        },
      ];
      const normalized = prefix.trim().toLowerCase();
      const matches = choices.filter((choice) => choice.value.startsWith(normalized));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const parsed = parseCommandArgs(args);
      if (parsed.error) {
        ctx.ui.notify(parsed.error, "error");
        return;
      }
      if (parsed.exportRequest) {
        await exportPromptFile(ctx, parsed.exportRequest);
        return;
      }

      let prompt = ctx.getSystemPrompt();

      // Prepend the date from pi-today for display only. Export uses Pi's base
      // prompt inputs and never persists this display-only line.
      if (todayDate) {
        prompt = `${todayDate}\n\n${prompt}`;
      }

      const promptLines = prompt.split("\n");
      const charCount = prompt.length;
      const lineCount = promptLines.length;

      // Gather tool definitions.
      const active = new Set(pi.getActiveTools());
      const activeTools = pi.getAllTools().filter((tool) => active.has(tool.name));
      const toolLines = buildToolLines(activeTools);

      const allLines = [
        ...promptLines,
        "",
        "────────────────────────────────────────",
        "",
        ...toolLines,
      ];

      const result = await ctx.ui.custom<ViewResult>(
        (tui, theme, _keybindings, done) =>
          new SystemPromptView(
            tui,
            allLines,
            activeTools,
            lineCount,
            charCount,
            allLines.length,
            theme,
            done,
          ),
        {
          overlay: true,
          overlayOptions: {
            width: "95%",
            maxHeight: "92%",
            anchor: "center",
            margin: 0,
          },
        },
      );

      if (result === "export") {
        await exportPromptFile(ctx, {});
      }
    },
  });
}

function parseCommandArgs(args: string): {
  exportRequest?: ExportRequest;
  error?: string;
} {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return {};
  }
  if (tokens[0]?.toLowerCase() !== "export") {
    return { error: exportUsage() };
  }
  if (tokens.length > 3) {
    return { error: exportUsage() };
  }

  const kind = tokens[1] ? parsePromptFileKind(tokens[1]) : undefined;
  if (tokens[1] && !kind) {
    return { error: `Unknown prompt file ${JSON.stringify(tokens[1])}.\n${exportUsage()}` };
  }

  const scope = tokens[2] ? parseExportScope(tokens[2]) : undefined;
  if (tokens[2] && !scope) {
    return { error: `Unknown export scope ${JSON.stringify(tokens[2])}.\n${exportUsage()}` };
  }

  return { exportRequest: { kind, scope } };
}

function parsePromptFileKind(value: string): PromptFileKind | undefined {
  switch (value.toLowerCase()) {
    case "system":
    case "system.md":
      return "system";
    case "append":
    case "append_system.md":
    case "append-system":
      return "append";
    default:
      return undefined;
  }
}

function parseExportScope(value: string): ExportScope | undefined {
  switch (value.toLowerCase()) {
    case "global":
    case "user":
      return "global";
    case "project":
    case "current":
    case "local":
      return "project";
    default:
      return undefined;
  }
}

function exportUsage(): string {
  return [
    "Usage:",
    "  /system-prompt",
    "  /system-prompt export [system|append] [global|project]",
  ].join("\n");
}

async function exportPromptFile(
  ctx: ExtensionCommandContext,
  request: ExportRequest,
): Promise<void> {
  const kind = request.kind ?? (await selectPromptFileKind(ctx));
  if (!kind) {
    return;
  }

  const scope = request.scope ?? (await selectExportScope(ctx));
  if (!scope) {
    return;
  }

  if (scope === "project" && !ctx.isProjectTrusted()) {
    const proceed = await ctx.ui.confirm(
      "Project is not trusted",
      `Write ${fileNameForKind(kind)} under ${join(ctx.cwd, CONFIG_DIR_NAME)} anyway? ` +
        "Pi will not load it until the project is trusted and reloaded.",
    );
    if (!proceed) {
      return;
    }
  }

  let content: string;
  try {
    content = getPromptFileContent(kind, ctx.getSystemPrompt(), ctx.getSystemPromptOptions());
  } catch (error) {
    ctx.ui.notify(`Could not export ${fileNameForKind(kind)}: ${formatError(error)}`, "error");
    return;
  }

  const targetPath = resolveExportPath(kind, scope, ctx.cwd);

  let existingContent: string | undefined;
  try {
    existingContent = await readFile(targetPath, "utf8");
  } catch (error) {
    if (!isNotFoundError(error)) {
      ctx.ui.notify(`Could not read ${targetPath}: ${formatError(error)}`, "error");
      return;
    }
  }

  if (existingContent === content) {
    ctx.ui.notify(`${targetPath} is already up to date.`, "info");
    return;
  }

  if (kind === "append" && content.length === 0) {
    const createEmpty = await ctx.ui.confirm(
      "No append prompt is active",
      `Create an empty starter file at ${targetPath}?`,
    );
    if (!createEmpty) {
      return;
    }
  }

  if (existingContent !== undefined) {
    const overwrite = await ctx.ui.confirm(
      `Overwrite ${fileNameForKind(kind)}?`,
      `${targetPath} already exists and contains different content.`,
    );
    if (!overwrite) {
      return;
    }
  }

  try {
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  } catch (error) {
    ctx.ui.notify(`Could not write ${targetPath}: ${formatError(error)}`, "error");
    return;
  }

  ctx.ui.notify(`Exported ${fileNameForKind(kind)} to ${targetPath}. Run /reload to load it.`, "info");
}

async function selectPromptFileKind(
  ctx: ExtensionCommandContext,
): Promise<PromptFileKind | undefined> {
  const selected = await ctx.ui.select("Export which prompt source?", [
    "SYSTEM.md — custom/default static prefix",
    "APPEND_SYSTEM.md — appended instructions",
  ]);
  if (selected?.startsWith("SYSTEM.md")) {
    return "system";
  }
  if (selected?.startsWith("APPEND_SYSTEM.md")) {
    return "append";
  }
  return undefined;
}

async function selectExportScope(ctx: ExtensionCommandContext): Promise<ExportScope | undefined> {
  const selected = await ctx.ui.select("Export scope", [
    `Global — ${getAgentDir()}`,
    `Current project — ${join(ctx.cwd, CONFIG_DIR_NAME)}`,
  ]);
  if (selected?.startsWith("Global")) {
    return "global";
  }
  if (selected?.startsWith("Current project")) {
    return "project";
  }
  return undefined;
}

function resolveExportPath(kind: PromptFileKind, scope: ExportScope, cwd: string): string {
  const directory = scope === "global" ? getAgentDir() : join(cwd, CONFIG_DIR_NAME);
  return join(directory, fileNameForKind(kind));
}

function fileNameForKind(kind: PromptFileKind): "SYSTEM.md" | "APPEND_SYSTEM.md" {
  return kind === "system" ? "SYSTEM.md" : "APPEND_SYSTEM.md";
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildToolLines(tools: ToolInfo[]): string[] {
  const lines: string[] = [];
  if (tools.length === 0) {
    lines.push("No tools registered.");
    return lines;
  }

  lines.push(`Tool Definitions (${tools.length} tools)`);
  lines.push("");

  for (const tool of tools) {
    const source = tool.sourceInfo?.source ?? "unknown";
    const sourceText = source === "builtin" ? "built-in" : source === "sdk" ? "SDK" : source;

    lines.push(`name: ${tool.name}`);
    lines.push(`  description: ${tool.description}`);
    lines.push(`  source: ${sourceText}`);
    lines.push("  parameters:");

    const paramLines = JSON.stringify(tool.parameters, null, 2).split("\n");
    for (const line of paramLines) {
      lines.push(`    ${line}`);
    }

    lines.push("");
  }

  return lines;
}

interface DisplayLine {
  text: string;
  originalIndex: number;
  continuation: boolean;
}

type LineStyle = "tools" | "guidelines" | "heading" | "bullet" | "toolLine" | "plain";

function lineStyle(originalLine: string): LineStyle {
  if (originalLine.startsWith("Available tools:")) return "tools";
  if (originalLine.startsWith("Guidelines:")) return "guidelines";
  if (/^#+\s/.test(originalLine)) return "heading";
  if (originalLine.startsWith("- ")) return "bullet";
  if (originalLine.startsWith("  ") || originalLine.startsWith("    ")) return "toolLine";
  return "plain";
}

function styleFirstLine(theme: Theme, text: string, style: LineStyle): string {
  switch (style) {
    case "tools":
      return theme.fg("success", theme.bold(text));
    case "guidelines":
    case "heading":
      return theme.fg("accent", theme.bold(text));
    case "bullet":
      return theme.fg("muted", text);
    default:
      return text;
  }
}

function styleContinuation(theme: Theme, text: string, style: LineStyle): string {
  switch (style) {
    case "bullet":
      return theme.fg("muted", text);
    case "heading":
      return theme.fg("dim", text);
    default:
      return theme.fg("dim", text);
  }
}

function enableMouse(): void {
  process.stdout.write("\x1b[?1000h");
  process.stdout.write("\x1b[?1006h");
}

function disableMouse(): void {
  process.stdout.write("\x1b[?1006l");
  process.stdout.write("\x1b[?1000l");
}

function parseSgrMouse(data: string): { wheelUp: number; wheelDown: number } | null {
  if (!data.startsWith("\x1b[<") || !data.endsWith("M")) return null;
  const parts = data.slice(3, -1).split(";");
  if (parts.length !== 3) return null;
  const button = Number.parseInt(parts[0] ?? "", 10);
  if (Number.isNaN(button)) return null;
  if (button === 64) return { wheelUp: 3, wheelDown: 0 };
  if (button === 65) return { wheelUp: 0, wheelDown: 3 };
  return null;
}

class SystemPromptView {
  private scrollOffset = 0;
  private copiedAt = 0;
  private readonly fullText: string;
  private totalDisplayLines = 0;

  constructor(
    private readonly tui: TUI,
    private readonly allLines: string[],
    private readonly allTools: ToolInfo[],
    private readonly promptLineCount: number,
    private readonly promptCharCount: number,
    private readonly combinedLineCount: number,
    private readonly theme: Theme,
    private readonly done: (result: ViewResult) => void,
  ) {
    this.fullText = allLines.join("\n");
    enableMouse();
  }

  handleInput(data: string): void {
    const visible = this.visibleLines();
    const total = this.totalDisplayLines || this.combinedLineCount;

    const mouse = parseSgrMouse(data);
    if (mouse) {
      if (mouse.wheelUp > 0) {
        this.scrollOffset = Math.max(0, this.scrollOffset - mouse.wheelUp);
      }
      if (mouse.wheelDown > 0) {
        this.scrollOffset = Math.min(
          Math.max(0, total - visible),
          this.scrollOffset + mouse.wheelDown,
        );
      }
      this.tui.requestRender?.();
      return;
    }

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      if (this.scrollOffset > 0) this.scrollOffset--;
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      if (this.scrollOffset < total - visible) this.scrollOffset++;
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, "pageUp")) {
      this.scrollOffset = Math.max(0, this.scrollOffset - visible);
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, "pageDown")) {
      this.scrollOffset = Math.min(Math.max(0, total - visible), this.scrollOffset + visible);
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, "home")) {
      this.scrollOffset = 0;
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, "end")) {
      this.scrollOffset = Math.max(0, total - visible);
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, "c")) {
      this.copyToClipboard();
      this.tui.requestRender?.();
      return;
    }
    if (matchesKey(data, "e")) {
      this.done("export");
      return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(null);
    }
  }

  private visibleLines(): number {
    const height = this.tui.terminal.rows;
    if (!height || height <= 0) return 30;
    return Math.max(1, Math.floor(height * 0.92) - 4);
  }

  private buildDisplayLines(contentWidth: number): DisplayLine[] {
    const displayLines: DisplayLine[] = [];
    for (let index = 0; index < this.allLines.length; index++) {
      const wrapped = wrapTextWithAnsi(this.allLines[index] ?? "", contentWidth);
      for (let wrappedIndex = 0; wrappedIndex < wrapped.length; wrappedIndex++) {
        displayLines.push({
          text: wrapped[wrappedIndex] ?? "",
          originalIndex: index,
          continuation: wrappedIndex > 0,
        });
      }
    }
    return displayLines;
  }

  render(width: number): string[] {
    const theme = this.theme;
    const innerWidth = Math.max(1, width - 2);
    const contentWidth = Math.max(1, innerWidth - 1);
    const visible = this.visibleLines();

    const displayLines = this.buildDisplayLines(contentWidth);
    this.totalDisplayLines = displayLines.length;

    const pad = (text: string, length: number) => {
      const currentWidth = visibleWidth(text);
      return text + " ".repeat(Math.max(0, length - currentWidth));
    };

    const row = (content: string) => {
      const fitted = truncateToWidth(content, innerWidth, "");
      return theme.fg("border", "│") + pad(fitted, innerWidth) + theme.fg("border", "│");
    };

    const output: string[] = [];
    output.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
    output.push(
      row(
        ` ${theme.fg("accent", theme.bold("System Prompt"))}  ${theme.fg("dim", `— ${this.promptLineCount} lines, ${this.promptCharCount.toLocaleString()} chars`)}  ${theme.fg("dim", `|  ${this.allTools.length} tools`)}`,
      ),
    );
    output.push(row(""));

    const end = Math.min(this.scrollOffset + visible, displayLines.length);
    for (let index = this.scrollOffset; index < end; index++) {
      const displayLine = displayLines[index];
      if (!displayLine) continue;
      const originalLine = this.allLines[displayLine.originalIndex] ?? "";
      const style = lineStyle(originalLine);
      const styled = displayLine.continuation
        ? styleContinuation(theme, displayLine.text, style)
        : styleFirstLine(theme, displayLine.text, style);
      output.push(row(` ${styled}`));
    }

    for (let index = end - this.scrollOffset; index < visible; index++) {
      output.push(row(""));
    }

    const percentage =
      displayLines.length > 0
        ? Math.round((this.scrollOffset / displayLines.length) * 100)
        : 0;
    const footerLeft = `${this.scrollOffset + 1}-${end}/${displayLines.length} (${percentage}%)`;
    const copyLabel = Date.now() - this.copiedAt < 2000 ? theme.fg("success", "copied") : "copy";
    const footerRight = `e export  c ${copyLabel}  ↑↓/jk pgup/pgdn home/end  Esc/q`;
    const gap = Math.max(
      1,
      innerWidth - 1 - visibleWidth(footerLeft) - visibleWidth(footerRight),
    );
    const footer =
      ` ${theme.fg("dim", footerLeft)}` +
      `${" ".repeat(gap)}${theme.fg("dim", footerRight)}`;
    output.push(row(""));
    output.push(row(footer));
    output.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return output;
  }

  private copyToClipboard(): void {
    const base64 = Buffer.from(this.fullText, "utf8").toString("base64");
    process.stdout.write(`\x1b]52;c;${base64}\x07`);
    this.copiedAt = Date.now();
  }

  invalidate(): void {}

  dispose(): void {
    disableMouse();
  }
}
