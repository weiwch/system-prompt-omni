/**
 * Persist the effective system prompt or provider tool definitions when either changes.
 *
 * Custom entries are durable but are not added to the LLM context. Load this
 * extension last if another extension rewrites the serialized provider payload
 * in before_provider_request.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  extractSerializedTools,
  extractProviderSystemInstructions,
  latestSystemPromptSnapshotHashes,
  sha256,
  SYSTEM_PROMPT_ENTRY_SCHEMA_VERSION,
  SYSTEM_PROMPT_ENTRY_TYPE,
} from "../lib/system-prompt-recorder.ts";

export default function systemPromptRecorder(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => {
    const systemPrompt = ctx.getSystemPrompt();
    const systemPromptSha256 = sha256(systemPrompt);
    const serializedTools = extractSerializedTools(event.payload);
    const serializedToolsSha256 =
      serializedTools === undefined ? undefined : sha256(serializedTools);

    // Compare both prompt and tool definitions with the latest snapshot on the
    // active branch. This also avoids duplicates after process restarts,
    // session resume, and extension reloads.
    const latestHashes = latestSystemPromptSnapshotHashes(ctx.sessionManager.getBranch());
    if (
      latestHashes?.systemPromptSha256 === systemPromptSha256 &&
      latestHashes.capturesSerializedTools &&
      latestHashes.serializedToolsSha256 === serializedToolsSha256
    ) {
      return undefined;
    }

    const providerSystemInstructions = extractProviderSystemInstructions(event.payload);
    const model = ctx.model;

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
      ...(serializedTools === undefined ? {} : { serializedTools }),
      providerSystemInstructions,
    });

    // Returning undefined leaves the provider payload unchanged.
    return undefined;
  });
}
