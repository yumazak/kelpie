// opencode v2 wire types.
//
// Mirrored from the service's own schemas (`packages/schema/src/*` in
// anomalyco/opencode @ v2.0.16), so a field that exists upstream exists here.
// The bridge passes the API's JSON through, so these are the service's shapes,
// not a reinterpretation.

/** `Model.Ref`. */
export interface OcModel {
  id?: string;
  providerID?: string;
  variant?: string;
}

/** `Session.Info.time`. */
export interface OcTime {
  created?: number;
  updated?: number;
  idle?: number;
  viewed?: number;
  archived?: number;
}

/** `Location.Ref`. */
export interface OcLocation {
  directory?: string;
  [key: string]: unknown;
}

export type OcOutcome = "succeeded" | "failed" | "interrupted";

/** `Session.Info` — one session, across every project. */
export interface OcSession {
  id: string;
  parentID?: string;
  projectID?: string;
  agent?: string;
  model?: OcModel;
  title?: string;
  /** Outcome of the last completed execution, recorded at `time.idle`. */
  outcome?: OcOutcome;
  time?: OcTime;
  location?: OcLocation;
  subpath?: string;
  metadata?: Record<string, unknown>;
  cost?: number;
  /** True while a turn is in flight (merged from `/api/session/active`). */
  active?: boolean;
}

/** The service's opaque page token; `next` fetches older sessions. */
export interface OcCursor {
  previous?: string | null;
  next?: string | null;
}

export interface OcSessionsResponse {
  version: string;
  sessions: OcSession[];
  cursor?: OcCursor | null;
}

/** `Session.Message.ToolState`. `input` is raw text while `status` is streaming. */
export interface OcToolState {
  status?: string;
  input?: unknown;
  content?: Array<{ type: string; text?: string }>;
  error?: unknown;
  metadata?: unknown;
}

/** `Session.Message.AssistantContent`. */
export type OcContentPart =
  | { type: "text"; text?: string }
  | {
      type: "reasoning";
      text?: string;
      time?: { created?: number; completed?: number };
    }
  | {
      type: "tool";
      id?: string;
      name?: string;
      executed?: boolean;
      state?: OcToolState;
      time?: { created?: number; ran?: number; completed?: number };
    };

/** `Prompt.FileAttachment`. */
export interface OcFileAttachment {
  uri: string;
  name?: string;
  description?: string;
}

/** `Session.Message.Info`. `type` discriminates: `user`, `assistant`, `idle`, … */
export interface OcMessage {
  id: string;
  type: string;
  time?: OcTime;
  metadata?: Record<string, unknown>;
  /** `user` */
  text?: string;
  files?: OcFileAttachment[];
  agents?: unknown[];
  skills?: unknown[];
  /** `assistant` */
  agent?: string;
  model?: OcModel;
  content?: OcContentPart[];
  cost?: number;
  error?: unknown;
  /** `idle` */
  outcome?: OcOutcome;
}

export interface OcMessagesResponse {
  data: OcMessage[];
  cursor?: OcCursor | null;
}

/** `Permission.Source` — the tool call a permission request gates. */
export interface OcPermissionSource {
  type: "tool";
  messageID: string;
  /** The id of the tool call inside that message. */
  id: string;
}

/** `Permission.Request`. */
export interface OcPermission {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  message?: string;
  source?: OcPermissionSource;
}

/** `Form.When` — all conditions on a field must hold (AND). */
export interface OcFormWhen {
  key: string;
  op: "eq" | "neq";
  value: string | number | boolean;
}

/** `Form.Option`. */
export interface OcFormOption {
  value: string;
  label: string;
  description?: string;
}

/** `Form.Field` (the union, flattened). */
export interface OcFormField {
  key: string;
  type: "string" | "number" | "integer" | "boolean" | "multiselect" | "external" | string;
  title?: string;
  description?: string;
  required?: boolean;
  /** Upstream: skip the interactive prompt and use the default unless answered. */
  hidden?: boolean;
  when?: OcFormWhen[];
  /** `string` */
  format?: "email" | "uri" | "date" | "date-time";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  placeholder?: string;
  /** `string` (with options) and `multiselect` */
  options?: OcFormOption[];
  custom?: boolean;
  minItems?: number;
  maxItems?: number;
  /** `number` / `integer` */
  minimum?: number;
  maximum?: number;
  /** `external` */
  url?: string;
  default?: string | number | boolean | string[];
}

/** The tool call a form belongs to (opencode ties them together). */
export interface OcFormToolRef {
  messageID?: string;
  /** The id of the tool call; matches the tool part's `toolCallId`. */
  id?: string;
}

export interface OcFormMetadata {
  /** `"question"` when the form backs the `question` tool. */
  kind?: string;
  tool?: OcFormToolRef;
  [key: string]: unknown;
}

/** A pending form (`Form.Info`), opencode v2's ask-the-user mechanism. */
export interface OcForm {
  id: string;
  sessionID: string;
  title?: string;
  metadata?: OcFormMetadata;
  fields: OcFormField[];
}
