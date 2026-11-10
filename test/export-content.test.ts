import assert from "node:assert/strict";
import test from "node:test";

import {
  getPromptFileContent,
  type PromptBuildOptions,
  type SkillReadTool,
} from "../lib/export-content.ts";

const skill = {
  name: "review&fix",
  description: "Review <code>",
  filePath: "/skills/review/SKILL.md",
};

const base = `Default preamble.

<tools>
- read: Read files
</tools>

<rules>
- Be concise
</rules>

<docs>
Pi documentation
</docs>`;

test("exports known custom and append sources even under a forced prompt", () => {
  const options = {
    customPrompt: "custom prefix",
    appendSystemPrompt: "extra rules",
    forceSystemPrompt: "per-turn replacement",
    cwd: "/work",
  };
  assert.equal(getPromptFileContent("system", "assembled prompt", options), "custom prefix");
  assert.equal(getPromptFileContent("append", "assembled prompt", options), "extra rules");
  assert.equal(getPromptFileContent("append", "ignored", { cwd: "/work" }), "");
});

test("exports the preamble from the native sections format, preserving its final newline", () => {
  const preamble = "You are an expert coding assistant operating inside pi.\n";
  const prompt = `${preamble}\n\n<cwd>\n/app\n</cwd>`;
  assert.equal(getPromptFileContent("system", prompt, { cwd: "/app" }), preamble);
});

test("strips rich dynamic sections while retaining every base section verbatim", () => {
  const prompt = `${base}

<addendum>
extra rules
</addendum>

<project_context>
Project-specific instructions and guidelines:

<project_instructions path="/work/AGENTS.md">
project rules
</project_instructions>

<project_instructions path="/work/src/AGENTS.md">
source rules
</project_instructions>
</project_context>

<skills>
Native skill instructions with escaped &amp; and &lt;code&gt;.
</skills>

<cwd>
C:/work
</cwd>

<environment>
Temporary environment details
</environment>`;
  const options = {
    appendSystemPrompt: "extra rules",
    cwd: "C:\\work",
    contextFiles: [
      { path: "/work/AGENTS.md", content: "project rules" },
      { path: "/work/src/AGENTS.md", content: "source rules" },
    ],
    skills: [skill],
    sections: { environment: "Temporary environment details", empty: "" },
  };
  assert.equal(
    getPromptFileContent("system", prompt, options, (reader) => {
      assert.equal(reader, "read");
      return "\n\nNative skill instructions with escaped &amp; and &lt;code&gt;.\n";
    }),
    base,
  );
});

test("uses Pi's native skill formatter with the available reader", () => {
  const cases: Array<{
    selectedTools?: string[];
    hiddenTools?: string[];
    reader?: SkillReadTool;
  }> = [
    { reader: "read" },
    { selectedTools: ["bash"], reader: "bash" },
    { selectedTools: ["bash", "read"], reader: "read" },
    { selectedTools: ["read", "bash"], hiddenTools: ["read"], reader: "bash" },
    { selectedTools: ["read"], hiddenTools: ["read"], reader: "indirect" },
    { selectedTools: ["bash"], hiddenTools: ["bash"], reader: "indirect" },
    { selectedTools: ["edit"] },
    { selectedTools: [] },
  ];
  for (const { reader, ...tools } of cases) {
    const prompt = reader
      ? `${base}\n\n<skills>\nNative instructions\n</skills>\n\n<cwd>\n/work\n</cwd>`
      : `${base}\n\n<cwd>\n/work\n</cwd>`;
    let calls = 0;
    assert.equal(
      getPromptFileContent("system", prompt, { cwd: "/work", skills: [skill], ...tools }, (actual) => {
        calls += 1;
        assert.equal(actual, reader);
        return "\n\nNative instructions";
      }),
      base,
    );
    assert.equal(calls, reader ? 1 : 0);
  }
});

test("does not expect a skills section when the native formatter excludes all skills", () => {
  assert.equal(
    getPromptFileContent(
      "system",
      `${base}\n\n<cwd>\n/work\n</cwd>`,
      { cwd: "/work", skills: [{ ...skill, disableModelInvocation: true }] },
      () => "",
    ),
    base,
  );
});

test("keeps native order when custom sections override existing dynamic sections", () => {
  const prompt = `${base}

<addendum>
replaced append
</addendum>

<project_context>
replaced context
</project_context>

<skills>
replaced skills
</skills>

<cwd>
/replaced
</cwd>

<environment>
extra context
</environment>`;
  assert.equal(
    getPromptFileContent(
      "system",
      prompt,
      {
        appendSystemPrompt: "original append",
        contextFiles: [{ path: "/work/AGENTS.md", content: "original context" }],
        skills: [skill],
        cwd: "/work",
        sections: {
          environment: "extra context",
          cwd: "/replaced",
          skills: "replaced skills",
          project_context: "replaced context",
          addendum: "replaced append",
        },
      },
      () => "original skills",
    ),
    base,
  );
});

test("appends custom dynamic sections that were absent from the base options", () => {
  const prompt = `${base}

<cwd>
/work
</cwd>

<skills>
custom skills
</skills>

<addendum>
custom addendum
</addendum>`;
  assert.equal(
    getPromptFileContent("system", prompt, {
      cwd: "/work",
      sections: { skills: "custom skills", addendum: "custom addendum", cwd: "" },
    }),
    base,
  );
});

test("refuses custom overrides of base sections instead of exporting them as static source", () => {
  for (const name of ["tools", "rules", "docs"]) {
    assert.throws(
      () => getPromptFileContent("system", `${base}\n\n<cwd>\n/work\n</cwd>`, {
        cwd: "/work",
        sections: { [name]: "temporary override" },
      }),
      /replaces part of the base prefix/,
    );
  }
  // Empty values do not override a section in Pi.
  assert.equal(
    getPromptFileContent("system", `${base}\n\n<cwd>\n/work\n</cwd>`, {
      cwd: "/work", sections: { tools: "", rules: "", docs: "" },
    }),
    base,
  );
});

test("rejects section names Pi cannot render", () => {
  for (const name of ["preamble", "Bad-Name", "bad name", "__proto__"]) {
    assert.throws(
      () => getPromptFileContent("system", "ignored", {
        cwd: "/work", sections: { [name]: "context" },
      }),
      /Invalid system prompt section name/,
    );
  }
});

test("refuses per-turn dynamic sections absent from the base options", () => {
  for (const name of ["addendum", "project_context", "skills", "cwd"]) {
    const injected = `<${name}>\nTemporary instructions\n</${name}>`;
    for (const prefix of [base, ""]) {
      const prompt = `${prefix}\n\n${injected}\n\n<cwd>\n/work\n</cwd>`;
      assert.throws(
        () => getPromptFileContent("system", prompt, { cwd: "/work" }),
        /remaining prefix contains per-turn dynamic sections/,
      );
    }
  }
});

test("fails closed for forced prompts, unexpected suffixes, missing formatters, and empty prefixes", () => {
  const prompt = `${base}\n\n<cwd>\n/work\n</cwd>`;
  const cases: Array<[string, PromptBuildOptions]> = [
    [prompt, { cwd: "/work", forceSystemPrompt: prompt }],
    [prompt, { cwd: "/work", forceSystemPrompt: "" }],
    [`${prompt}\n\n<extra>\nunsaved context\n</extra>`, { cwd: "/work" }],
    ["default prefix\nCurrent working directory: /work", { cwd: "/work" }],
    [prompt, { cwd: "/elsewhere" }],
    [prompt, { cwd: "/work", skills: [skill] }],
    ["\n\n<cwd>\n/work\n</cwd>", { cwd: "/work" }],
  ];
  for (const [text, options] of cases) {
    assert.throws(
      () => getPromptFileContent("system", text, options),
      /Refusing to export dynamic context/,
    );
  }
});
