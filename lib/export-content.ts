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
  appendSystemPrompt?: string;
  sections?: Record<string, string>;
  cwd: string;
  contextFiles?: PromptContextFile[];
  skills?: PromptSkill[];
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
