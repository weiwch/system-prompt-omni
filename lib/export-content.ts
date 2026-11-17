export type PromptFileKind = "system" | "append";
export type SkillReadTool = "read" | "bash" | "indirect";

export interface PromptContextFile {
  path: string;
  content: string;
}

export interface PromptSkill {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

export interface PromptBuildOptions {
  customPrompt?: string;
  forceSystemPrompt?: string;
  selectedTools?: string[];
  hiddenTools?: string[];
  toolSnippets?: Record<string, string>;
  toolGuidelines?: Record<string, string[]>;
  promptGuidelines?: string[];
  appendSystemPrompt?: string;
  sections?: Record<string, string>;
  cwd: string;
  contextFiles?: PromptContextFile[];
  skills?: PromptSkill[];
}

/** Native Pi version and documentation paths, supplied by public config helpers. */
export interface PiDocumentationPaths {
  version: string;
  readme: string;
  docs: string;
  examples: string;
}

/** Render the configured skills with Pi's public formatSkillsForPrompt helper. */
export type SkillPromptFormatter = (reader: SkillReadTool) => string;

/**
 * Export prompt source, excluding the dynamic sections Pi adds when loading it.
 * The native skill formatter is supplied by the extension so this helper does
 * not duplicate version-dependent skill instructions or require Pi in tests.
 */
export function getPromptFileContent(
  kind: PromptFileKind,
  systemPrompt: string,
  options: PromptBuildOptions,
  formatSkills?: SkillPromptFormatter,
  documentationPaths?: PiDocumentationPaths,
): string {
  if (kind === "append") {
    return options.appendSystemPrompt ?? "";
  }

  // A known source file is safe to export even if a per-turn prompt is active.
  if (options.customPrompt) {
    return options.customPrompt;
  }

  if (options.forceSystemPrompt !== undefined) {
    throw unsafeExport("A forced system prompt has no separable base prefix.");
  }

  // Pi v1.5.2 may show a per-turn modified prompt, while these options describe
  // the reusable base source. Reconstruct only native static sections.
  if (documentationPaths?.version === "1.5.2") {
    for (const [name, content] of Object.entries(options.sections ?? {})) {
      if (!/^[a-z][a-z0-9_-]*$/.test(name) || name === "preamble") {
        throw unsafeExport(`Invalid system prompt section name: ${name}.`);
      }
      if (content && ["tools", "rules", "docs"].includes(name)) {
        throw unsafeExport(`The custom ${name} section replaces part of the base prefix.`);
      }
    }
    return buildPiV152BasePrompt(options, documentationPaths);
  }

  const dynamicSuffix = buildDynamicSuffix(options, formatSkills);
  if (!systemPrompt.endsWith(dynamicSuffix)) {
    throw unsafeExport("The current prompt does not match Pi's base prompt layout.");
  }

  const prefix = systemPrompt.slice(0, -dynamicSuffix.length);
  if (!prefix.trim()) {
    throw unsafeExport("The current prompt has no base prefix.");
  }
  // getSystemPromptOptions() describes the base inputs. A per-turn extension
  // can add a dynamic section before cwd without changing that expected suffix.
  // Such a section must not be mistaken for part of the reusable source.
  if (/^<(?:addendum|project_context|skills|cwd)>\r?$/m.test(prefix)) {
    throw unsafeExport("The remaining prefix contains per-turn dynamic sections.");
  }
  return prefix;
}

const PI_V152_PREAMBLE = "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";

/** Reconstruct Pi v1.5.2's native static base, excluding all dynamic sections. */
function buildPiV152BasePrompt(options: PromptBuildOptions, paths: PiDocumentationPaths): string {
  const selectedTools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  const declaredTools = selectedTools.filter((name) => !options.hiddenTools?.includes(name));
  const snippets = options.toolSnippets ?? {};
  const visibleTools = declaredTools.filter((name) => !!snippets[name]);
  const tools = visibleTools.length > 0
    ? visibleTools.map((name) => `- ${name}: ${snippets[name]}`).join("\n")
    : "(none)";
  const toolSection = `${tools}\n\nAdditional tools may be available.`;
  const ruleSection = buildPiV152Rules(declaredTools, options.toolGuidelines ?? {}, options.promptGuidelines ?? []);
  const docsSection = `Pi documentation (read only when the user asks about the harness itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${paths.readme}
- Additional docs: ${paths.docs}
- Examples: ${paths.examples} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- Before implementing harness changes, read the relevant docs and examples in full, following related cross-references.`;
  return [
    PI_V152_PREAMBLE,
    `<tools>\n${toolSection}\n</tools>`,
    `<rules>\n${ruleSection}\n</rules>`,
    `<docs>\n${docsSection}\n</docs>`,
  ].join("\n\n");
}

function buildPiV152Rules(
	selectedTools: string[],
	toolGuidelines: Record<string, string[]>,
	promptGuidelines: string[],
): string {
	const rules: string[] = [];
	const seen = new Set<string>();
	const addRule = (rule: string): void => {
		const normalized = rule.trim();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		rules.push(normalized);
	};

	const hasBash = selectedTools.includes("bash");
	const hasPowerShell = selectedTools.includes("powershell");
	const hasGrep = selectedTools.includes("grep");
	const hasFind = selectedTools.includes("find");
	const hasLs = selectedTools.includes("ls");

	if ((hasBash || hasPowerShell) && !hasGrep && !hasFind && !hasLs) {
		if (hasBash && hasPowerShell) {
			addRule("Use bash or PowerShell for file operations like listing, searching, and finding files");
		} else if (hasPowerShell) {
			addRule("Use PowerShell for file operations like listing, searching, and finding files");
		} else {
			addRule("Use bash for file operations like ls, rg, find");
		}
	}

	for (const name of selectedTools) {
		for (const rule of toolGuidelines[name] ?? []) addRule(rule);
	}
	for (const rule of promptGuidelines) addRule(rule);
	addRule("Be concise in your responses");
	addRule("Show file paths clearly when working with files");
	return rules.map((rule) => `- ${rule}`).join("\n");
}

function unsafeExport(reason: string): Error {
  return new Error(`${reason} Refusing to export dynamic context into SYSTEM.md.`);
}

function buildDynamicSuffix(
  options: PromptBuildOptions,
  formatSkills?: SkillPromptFormatter,
): string {
  // Map preserves the native section order when a custom section replaces an
  // existing one, and appends newly introduced sections after cwd.
  const sections = new Map<string, string>();

  if (options.appendSystemPrompt) {
    sections.set("addendum", options.appendSystemPrompt);
  }

  const contextFiles = options.contextFiles ?? [];
  if (contextFiles.length > 0) {
    sections.set(
      "project_context",
      [
        "Project-specific instructions and guidelines:",
        ...contextFiles.map(
          ({ path, content }) =>
            `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
        ),
      ].join("\n\n"),
    );
  }

  const selectedTools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  const declaredTools = selectedTools.filter((name) => !options.hiddenTools?.includes(name));
  const readers = ["read", "bash"] as const;
  const reader =
    readers.find((name) => declaredTools.includes(name)) ??
    (readers.some((name) => selectedTools.includes(name)) ? "indirect" : undefined);

  if (reader && (options.skills?.length ?? 0) > 0) {
    if (!formatSkills) {
      throw unsafeExport("Pi's skill formatter is required for the configured skills.");
    }
    const skills = formatSkills(reader).trim();
    if (skills) {
      sections.set("skills", skills);
    }
  }

  sections.set("cwd", options.cwd.replace(/\\/g, "/"));

  for (const [name, content] of Object.entries(options.sections ?? {})) {
    if (!/^[a-z][a-z0-9_-]*$/.test(name) || name === "preamble") {
      throw unsafeExport(`Invalid system prompt section name: ${name}.`);
    }
    if (!content) continue;
    if (["tools", "rules", "docs"].includes(name)) {
      throw unsafeExport(`The custom ${name} section replaces part of the base prefix.`);
    }
    sections.set(name, content);
  }

  return [...sections]
    .map(([name, content]) => `\n\n<${name}>\n${content}\n</${name}>`)
    .join("");
}
