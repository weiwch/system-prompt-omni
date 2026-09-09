import assert from "node:assert/strict";
import test from "node:test";

import systemPromptRecorder from "../extensions/pi-system-prompt-recorder.ts";
import {
  extractSerializedTools,
  extractProviderSystemInstructions,
  latestSystemPromptSnapshotHashes,
  latestSystemPromptSha256,
  sha256,
  SYSTEM_PROMPT_ENTRY_TYPE,
} from "../lib/system-prompt-recorder.ts";

test("serializes tools directly from an OpenAI provider payload without reordering", () => {
  const tools = [
    {
      type: "function",
      function: {
        name: "write",
        description: "Write files",
        parameters: { type: "object", required: ["path", "content"] },
      },
    },
    {
      type: "function",
      function: {
        name: "read",
        description: "Read files",
        parameters: { type: "object", required: ["path"] },
      },
    },
  ];

  assert.equal(extractSerializedTools({ model: "model-1", tools }), JSON.stringify(tools));
});

test("extracts provider-specific nested tool payloads", () => {
  const responsesTools = [
    { type: "function", name: "read", description: "Read files", parameters: {} },
  ];
  const googleTools = [{ functionDeclarations: [{ name: "read", parametersJsonSchema: {} }] }];
  const bedrockTools = [{ toolSpec: { name: "read", inputSchema: { json: {} } } }];
  const piMessageTools = [{ name: "read", description: "Read files", parameters: {} }];

  assert.equal(extractSerializedTools({ tools: responsesTools }), JSON.stringify(responsesTools));
  assert.equal(
    extractSerializedTools({ config: { tools: googleTools } }),
    JSON.stringify(googleTools),
  );
  assert.equal(
    extractSerializedTools({ toolConfig: { tools: bedrockTools } }),
    JSON.stringify(bedrockTools),
  );
  assert.equal(
    extractSerializedTools({ context: { tools: piMessageTools } }),
    JSON.stringify(piMessageTools),
  );
  assert.equal(
    extractSerializedTools({ body: { tools: responsesTools } }),
    JSON.stringify(responsesTools),
  );
  assert.equal(extractSerializedTools({ messages: [] }), undefined);
});

test("extracts top-level and wrapped provider instructions without the full payload", () => {
  const payload = {
    instructions: "top-level",
    messages: [
      { role: "system", content: "system message" },
      { role: "user", content: "private conversation text" },
      { role: "developer", content: [{ type: "text", text: "developer message" }] },
    ],
    tools: [{ name: "large-duplicate" }],
    body: {
      system_instruction: { parts: [{ text: "wrapped system" }] },
      input: [{ role: "system", content: "wrapped input" }],
    },
  };

  assert.deepEqual(extractProviderSystemInstructions(payload), [
    { path: "$.instructions", value: "top-level" },
    { path: "$.messages[0].content", role: "system", value: "system message" },
    {
      path: "$.messages[2].content",
      role: "developer",
      value: [{ type: "text", text: "developer message" }],
    },
    {
      path: "$.body.system_instruction",
      value: { parts: [{ text: "wrapped system" }] },
    },
    { path: "$.body.input[0].content", role: "system", value: "wrapped input" },
  ]);
});

test("finds the newest snapshot hash and supports pre-hash entries", () => {
  assert.equal(
    latestSystemPromptSha256([
      { type: "custom", customType: SYSTEM_PROMPT_ENTRY_TYPE, data: { systemPrompt: "old" } },
    ]),
    sha256("old"),
  );

  assert.equal(
    latestSystemPromptSha256([
      { type: "custom", customType: SYSTEM_PROMPT_ENTRY_TYPE, data: { systemPromptSha256: "a" } },
      { type: "message", data: {} },
      { type: "custom", customType: SYSTEM_PROMPT_ENTRY_TYPE, data: { systemPromptSha256: "b" } },
    ]),
    "b",
  );

  assert.deepEqual(
    latestSystemPromptSnapshotHashes([
      {
        type: "custom",
        customType: SYSTEM_PROMPT_ENTRY_TYPE,
        data: { schemaVersion: 2, systemPrompt: "old", serializedTools: "[]" },
      },
    ]),
    {
      systemPromptSha256: sha256("old"),
      serializedToolsSha256: sha256("[]"),
      capturesSerializedTools: true,
    },
  );
});

test("records a changed prompt once and leaves the provider payload unchanged", () => {
  let handler: ((event: any, ctx: any) => unknown) | undefined;
  const branch: any[] = [];
  const appended: Array<{ customType: string; data: any }> = [];
  const pi = {
    on(event: string, callback: (event: any, ctx: any) => unknown) {
      assert.equal(event, "before_provider_request");
      handler = callback;
    },
    appendEntry(customType: string, data: any) {
      appended.push({ customType, data });
      branch.push({ type: "custom", customType, data });
    },
    getThinkingLevel: () => "high",
  };

  systemPromptRecorder(pi as never);
  assert.ok(handler);

  const payload = {
    system: "provider system",
    messages: [{ role: "user", content: "hello" }],
    tools: [
      {
        type: "function",
        name: "read",
        description: "Read files",
        parameters: { type: "object" },
      },
    ],
  };
  const ctx = {
    getSystemPrompt: () => "effective prompt 🚀",
    sessionManager: { getBranch: () => branch },
    model: { provider: "example", id: "model-1", api: "responses" },
  };

  assert.equal(handler({ payload }, ctx), undefined);
  assert.equal(handler({ payload }, ctx), undefined);
  assert.equal(appended.length, 1);
  assert.equal(appended[0]?.customType, SYSTEM_PROMPT_ENTRY_TYPE);
  assert.deepEqual(appended[0]?.data, {
    schemaVersion: 2,
    captureStage: "before_provider_request",
    capturedAt: appended[0]?.data.capturedAt,
    systemPrompt: "effective prompt 🚀",
    systemPromptSha256: sha256("effective prompt 🚀"),
    systemPromptUtf8Bytes: Buffer.byteLength("effective prompt 🚀", "utf8"),
    provider: "example",
    modelId: "model-1",
    api: "responses",
    thinkingLevel: "high",
    serializedTools:
      '[{"type":"function","name":"read","description":"Read files","parameters":{"type":"object"}}]',
    providerSystemInstructions: [{ path: "$.system", value: "provider system" }],
  });
  assert.match(appended[0]?.data.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("records a new snapshot when tools change but the prompt does not", () => {
  let handler: ((event: any, ctx: any) => unknown) | undefined;
  const branch: any[] = [];
  const pi = {
    on(_event: string, callback: (event: any, ctx: any) => unknown) {
      handler = callback;
    },
    appendEntry(customType: string, data: any) {
      branch.push({ type: "custom", customType, data });
    },
    getThinkingLevel: () => "off",
  };
  const ctx = {
    getSystemPrompt: () => "unchanged prompt",
    sessionManager: { getBranch: () => branch },
    model: undefined,
  };

  systemPromptRecorder(pi as never);
  assert.ok(handler);
  const firstPayload = {
    tools: [{ type: "function", name: "read", description: "Read files", parameters: {} }],
  };
  const secondPayload = {
    tools: [
      { type: "function", name: "read", description: "Read files safely", parameters: {} },
    ],
  };
  handler({ payload: firstPayload }, ctx);
  handler({ payload: firstPayload }, ctx);
  handler({ payload: secondPayload }, ctx);

  assert.equal(branch.length, 2);
  assert.notEqual(branch[0]?.data.serializedTools, branch[1]?.data.serializedTools);
});
