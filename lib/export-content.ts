export type PromptFileKind = "system" | "append";

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
  selectedTools?: string[];
  appendSystemPrompt?: string;
  cwd: string;
  contextFiles?: PromptContextFile[];
  skills?: PromptSkill[];
}

/**
 * Return content that is safe to persist as one of Pi's prompt source files.
 * SYSTEM.md contains only the custom/default prefix; Pi will append dynamic
 * context, skills, and cwd again when it loads the file.
 */
export function getPromptFileContent(
  kind: PromptFileKind,
  systemPrompt: string,
  options: PromptBuildOptions,
): string {
  if (kind === "append") {
    return options.appendSystemPrompt ?? "";
  }

  // Pi treats a truthy customPrompt as the complete SYSTEM.md/template prefix.
  if (options.customPrompt) {
    return options.customPrompt;
  }

  const dynamicSuffix = buildDynamicSuffix(options);
  if (!systemPrompt.endsWith(dynamicSuffix)) {
    throw new Error(
      "The current prompt does not match Pi's base prompt layout. " +
        "A per-turn extension may have changed it; refusing to export dynamic context into SYSTEM.md.",
    );
  }

  return systemPrompt.slice(0, -dynamicSuffix.length);
}

function buildDynamicSuffix(options: PromptBuildOptions): string {
  let suffix = "";

  if (options.appendSystemPrompt) {
    suffix += `\n\n${options.appendSystemPrompt}`;
  }

  const contextFiles = options.contextFiles ?? [];
  if (contextFiles.length > 0) {
    suffix += "\n\n<project_context>\n\n";
    suffix += "Project-specific instructions and guidelines:\n\n";
    for (const contextFile of contextFiles) {
      suffix += `<project_instructions path="${contextFile.path}">\n`;
      suffix += `${contextFile.content}\n`;
      suffix += "</project_instructions>\n\n";
    }
    suffix += "</project_context>\n";
  }

  const hasReadTool = !options.selectedTools || options.selectedTools.includes("read");
  if (hasReadTool) {
    suffix += formatSkills(options.skills ?? []);
  }

  suffix += `\nCurrent working directory: ${options.cwd.replace(/\\/g, "/")}`;
  return suffix;
}

function formatSkills(skills: PromptSkill[]): string {
  const visibleSkills = skills.filter((skill) => !skill.disableModelInvocation);
  if (visibleSkills.length === 0) {
    return "";
  }

  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];

  for (const skill of visibleSkills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
