import assert from "node:assert/strict";
import test from "node:test";

import { getPromptFileContent, type PiDocumentationPaths, type PromptBuildOptions } from "../lib/export-content.ts";

// Native Pi v1.5.2 static prompt snapshot, with base tool snippets and guidelines.
const paths: PiDocumentationPaths = { version: "1.5.2", readme: "/pi/README.md", docs: "/pi/docs", examples: "/pi/examples" };
const options: PromptBuildOptions = {
  cwd: "/repo", selectedTools: ["read", "bash", "edit"],
  toolSnippets: { read: "Read files", bash: "Execute commands" },
  toolGuidelines: { bash: ["Avoid unnecessary commands"] },
  promptGuidelines: ["Avoid unnecessary commands"],
};
const preamble = "You are a coding assistant running inside pi, a coding agent harness. Help users inspect files, run commands, and modify code.";
const expected = `${preamble}

<tools>
- read: Read files
- bash: Execute commands

Additional tools may be available.
</tools>

<rules>
- Use bash for file operations like ls, rg, find
- Avoid unnecessary commands
- Be concise in your responses
- Show file paths clearly when working with files
</rules>

<docs>
Pi documentation (read only when the user asks about the harness itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: /pi/README.md
- Additional docs: /pi/docs
- Examples: /pi/examples (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), packages (docs/packages.md), environment variables (docs/environment-variables.md), MCP servers (docs/mcp.md), codemode scripts and non-LLM models such as classifiers and image models (docs/codemode.md)
- Before implementing harness changes, read the relevant docs and examples in full, following related cross-references.
</docs>`;
const exportSystem = (effective: string, inputs = options) =>
  getPromptFileContent("system", effective, inputs, undefined, paths);

test("Pi 1.5.2 native default prefix is exported exactly", () => {
  assert.equal(exportSystem(`${expected}\n\n<cwd>\n/repo\n</cwd>`), expected);
});

test("per-turn dynamic suffix changes never enter SYSTEM.md", () => {
  assert.equal(exportSystem(`${expected}\n\n<cwd>\n/changed\n</cwd>\n\n<temporary>\nprivate\n</temporary>`), expected);
  assert.equal(exportSystem(expected), expected);
});

test("per-turn changes of tools, rules, docs, and preamble are not persisted", () => {
  for (const current of [
    expected.replace("- read: Read files", "- read: injected"),
    expected.replace("- Avoid unnecessary commands", "- temporary rule"),
    expected.replace("- Main documentation: /pi/README.md", "- Main documentation: injected"),
    `Date injected\n\n${expected}`,
    "A forced per-turn replacement",
  ]) assert.equal(exportSystem(current), expected);
});

test("hidden declarations are respected", () => {
  const altered = expected.replace("- bash: Execute commands\n", "").replace("- Use bash for file operations like ls, rg, find\n", "");
  assert.equal(exportSystem(altered, { ...options, hiddenTools: ["bash"] }), altered);
});

test("explicit custom and append sources still export", () => {
  assert.equal(exportSystem("effective", { ...options, customPrompt: "explicit source" }), "explicit source");
  assert.equal(getPromptFileContent("append", "effective", { ...options, appendSystemPrompt: "append source" }, undefined, paths), "append source");
});

test("forced base prompts and dynamic overrides of core sections remain blocked", () => {
  assert.throws(() => exportSystem(expected, { ...options, forceSystemPrompt: "forced" }), /forced system prompt/);
  for (const name of ["tools", "rules", "docs"]) {
    assert.throws(() => exportSystem(expected, { ...options, sections: { [name]: "override" } }), /replaces part of the base prefix/);
  }
  assert.throws(() => exportSystem(expected, { ...options, sections: { "Bad Name": "context" } }), /Invalid system prompt section/);
});

test("older Pi versions continue to reject mismatched suffixes", () => {
  const oldPaths = { ...paths, version: "0.86.0" };
  const oldPrompt = "Legacy prompt\n\n<cwd>\n/repo\n</cwd>";
  assert.equal(getPromptFileContent("system", oldPrompt, options, undefined, oldPaths), "Legacy prompt");
  assert.throws(() => getPromptFileContent("system", "wrong", options, undefined, oldPaths), /base prompt layout/);
});
