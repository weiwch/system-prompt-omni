import assert from "node:assert/strict";
import test from "node:test";

import { getPromptFileContent } from "../lib/export-content.ts";

test("exports an existing custom prompt directly to SYSTEM.md", () => {
  assert.equal(
    getPromptFileContent("system", "assembled prompt", {
      customPrompt: "custom prefix",
      cwd: "/work",
    }),
    "custom prefix",
  );
});

test("strips append text, context, skills, and cwd from a default prompt", () => {
  const prefix = "default prefix";
  const append = "extra rules";
  const context =
    "\n\n<project_context>\n\n" +
    "Project-specific instructions and guidelines:\n\n" +
    '<project_instructions path="/work/AGENTS.md">\nproject rules\n</project_instructions>\n\n' +
    "</project_context>\n";
  const skills =
    "\n\nThe following skills provide specialized instructions for specific tasks.\n" +
    "Use the read tool to load a skill's file when the task matches its description.\n" +
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n\n" +
    "<available_skills>\n" +
    "  <skill>\n" +
    "    <name>review&amp;fix</name>\n" +
    "    <description>Review &lt;code&gt;</description>\n" +
    "    <location>/skills/review/SKILL.md</location>\n" +
    "  </skill>\n" +
    "</available_skills>";
  const prompt = `${prefix}\n\n${append}${context}${skills}\nCurrent working directory: /work`;

  assert.equal(
    getPromptFileContent("system", prompt, {
      appendSystemPrompt: append,
      cwd: "/work",
      contextFiles: [{ path: "/work/AGENTS.md", content: "project rules" }],
      skills: [
        {
          name: "review&fix",
          description: "Review <code>",
          filePath: "/skills/review/SKILL.md",
        },
        {
          name: "manual-only",
          description: "Hidden",
          filePath: "/skills/manual/SKILL.md",
          disableModelInvocation: true,
        },
      ],
      selectedTools: ["read", "bash"],
    }),
    prefix,
  );
});

test("does not expect a skills suffix when read is inactive", () => {
  const prompt = "default prefix\nCurrent working directory: C:/work";
  assert.equal(
    getPromptFileContent("system", prompt, {
      cwd: "C:\\work",
      selectedTools: ["bash"],
      skills: [
        {
          name: "unused",
          description: "Not injected without read",
          filePath: "C:/skills/unused/SKILL.md",
        },
      ],
    }),
    "default prefix",
  );
});

test("exports configured append content and supports an empty starter file", () => {
  assert.equal(
    getPromptFileContent("append", "ignored", {
      appendSystemPrompt: "extra rules",
      cwd: "/work",
    }),
    "extra rules",
  );
  assert.equal(getPromptFileContent("append", "ignored", { cwd: "/work" }), "");
});

test("fails closed when the dynamic suffix cannot be identified", () => {
  assert.throws(
    () => getPromptFileContent("system", "prompt changed by another extension", { cwd: "/work" }),
    /refusing to export dynamic context/,
  );
});
