import { createHash } from "node:crypto";

export const SYSTEM_PROMPT_ENTRY_TYPE = "pi-system-prompt";
export const SYSTEM_PROMPT_ENTRY_SCHEMA_VERSION = 2;

export interface SystemPromptSnapshotHashes {
  systemPromptSha256?: string;
  serializedToolsSha256?: string;
  capturesSerializedTools: boolean;
}

interface CustomEntryLike {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function jsonSnapshot(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return "[unserializable provider system instruction]";
  }
}

function valueAtPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = root;
  for (const segment of path) {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

/**
 * Serialize the tool definitions from Pi's final provider payload without
 * rebuilding, sorting, or normalizing them. The paths cover Pi's current
 * provider transports, including OpenAI, Anthropic, Google, Bedrock, and the
 * pi-messages API.
 */
export function extractSerializedTools(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const toolPaths = [
    ["tools"],
    ["config", "tools"],
    ["toolConfig", "tools"],
    ["context", "tools"],
    ["body", "tools"],
    ["body", "config", "tools"],
    ["body", "toolConfig", "tools"],
    ["body", "context", "tools"],
  ] as const;

  for (const path of toolPaths) {
    const tools = valueAtPath(payload, path);
    if (tools === undefined) continue;
    return JSON.stringify(tools);
  }
  return undefined;
}

function pushField(
  result: Array<Record<string, unknown>>,
  root: Record<string, unknown>,
  key: string,
  prefix = "$",
): void {
  if (!Object.prototype.hasOwnProperty.call(root, key)) return;
  const value = root[key];
  if (value === undefined || value === null) return;
  result.push({ path: `${prefix}.${key}`, value: jsonSnapshot(value) });
}

function pushRoleMessages(
  result: Array<Record<string, unknown>>,
  root: Record<string, unknown>,
  key: string,
  prefix = "$",
): void {
  const messages = root[key];
  if (!Array.isArray(messages)) return;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!isRecord(message)) continue;
    if (message.role !== "system" && message.role !== "developer") continue;

    result.push({
      path: `${prefix}.${key}[${index}].content`,
      role: message.role,
      value: jsonSnapshot(message.content),
    });
  }
}

/**
 * Extract provider-level system instructions without persisting the complete
 * request payload, which would duplicate the conversation and tool schemas.
 */
export function extractProviderSystemInstructions(
  payload: unknown,
): Array<Record<string, unknown>> {
  if (!isRecord(payload)) return [];

  const result: Array<Record<string, unknown>> = [];
  const roots = [{ value: payload, prefix: "$" }];

  // Some custom transports wrap the JSON body one level down.
  if (isRecord(payload.body)) {
    roots.push({ value: payload.body, prefix: "$.body" });
  }

  for (const { value: root, prefix } of roots) {
    for (const key of [
      "instructions",
      "system",
      "system_instruction",
      "systemInstruction",
      "systemPrompt",
      "preamble",
    ]) {
      pushField(result, root, key, prefix);
    }
    pushRoleMessages(result, root, "messages", prefix);
    pushRoleMessages(result, root, "input", prefix);
  }

  return result;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function latestSystemPromptSha256(entries: readonly CustomEntryLike[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== SYSTEM_PROMPT_ENTRY_TYPE) continue;
    if (!isRecord(entry.data)) continue;
    if (typeof entry.data.systemPromptSha256 === "string") {
      return entry.data.systemPromptSha256;
    }
    // Compatibility with snapshots written before the hash field existed.
    if (typeof entry.data.systemPrompt === "string") {
      return sha256(entry.data.systemPrompt);
    }
  }
  return undefined;
}

/** Return the hashes from the newest recorder snapshot on the active branch. */
export function latestSystemPromptSnapshotHashes(
  entries: readonly CustomEntryLike[],
): SystemPromptSnapshotHashes | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== SYSTEM_PROMPT_ENTRY_TYPE) continue;
    if (!isRecord(entry.data)) continue;

    const systemPromptSha256 =
      typeof entry.data.systemPromptSha256 === "string"
        ? entry.data.systemPromptSha256
        : typeof entry.data.systemPrompt === "string"
          ? sha256(entry.data.systemPrompt)
          : undefined;
    const serializedToolsSha256 =
      typeof entry.data.serializedTools === "string"
        ? sha256(entry.data.serializedTools)
        : undefined;
    const capturesSerializedTools =
      typeof entry.data.schemaVersion === "number" &&
      entry.data.schemaVersion >= SYSTEM_PROMPT_ENTRY_SCHEMA_VERSION;

    return { systemPromptSha256, serializedToolsSha256, capturesSerializedTools };
  }
  return undefined;
}
