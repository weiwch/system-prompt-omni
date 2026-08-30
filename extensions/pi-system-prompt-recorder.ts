/**
 * Persist the effective system prompt when it changes.
 *
 * Custom entries are durable but are not added to the LLM context. Load this
 * extension last if another extension rewrites the serialized provider payload
 * in before_provider_request.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  extractProviderSystemInstructions,
  latestSystemPromptSha256,
  sha256,
  SYSTEM_PROMPT_ENTRY_SCHEMA_VERSION,
  SYSTEM_PROMPT_ENTRY_TYPE,
} from "../lib/system-prompt-recorder.ts";

export default function systemPromptRecorder(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => {
    const systemPrompt = ctx.getSystemPrompt();
    const systemPromptSha256 = sha256(systemPrompt);

    // Compare with the latest snapshot on the active branch. This also avoids
    // duplicates after process restarts, session resume, and extension reloads.
    if (latestSystemPromptSha256(ctx.sessionManager.getBranch()) === systemPromptSha256) {
      return undefined;
    }

    const providerSystemInstructions = extractProviderSystemInstructions(event.payload);
    const model = ctx.model;
    const activeTools = pi.getActiveTools();
    const toolsByName = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
    const tools = activeTools.flatMap((name) => {
      const tool = toolsByName.get(name);
      if (!tool) return [];
      return [{ name: tool.name, description: tool.description, parameters: tool.parameters }];
    });

    pi.appendEntry(SYSTEM_PROMPT_ENTRY_TYPE, {
      schemaVersion: SYSTEM_PROMPT_ENTRY_SCHEMA_VERSION,
      captureStage: "before_provider_request",
      capturedAt: new Date().toISOString(),
      systemPrompt,
      systemPromptSha256,
      systemPromptUtf8Bytes: Buffer.byteLength(systemPrompt, "utf8"),
      provider: model?.provider,
      modelId: model?.id,
      api: model?.api,
      thinkingLevel: pi.getThinkingLevel(),
      activeTools,
      tools,
      providerSystemInstructions,
    });

    // Returning undefined leaves the provider payload unchanged.
    return undefined;
  });
}
