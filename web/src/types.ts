// opencode v2 wire types. The bridge passes the API's JSON through, so these
// mirror the service's own shapes.

export interface OcModel {
  id?: string;
  providerID?: string;
  variant?: string;
}

export interface OcTime {
  created?: number;
  updated?: number;
  idle?: number;
  viewed?: number;
}

/** One opencode session (the cross-project list is `data[]`). */
export interface OcSession {
  id: string;
  parentID?: string;
  projectID?: string;
  agent?: string;
  model?: OcModel;
  title?: string;
  outcome?: "succeeded" | "failed" | "interrupted";
  time?: OcTime;
  location?: { directory?: string };
  cost?: number;
  /** True while a turn is in flight (merged from `/api/session/active`). */
  active?: boolean;
}

export interface OcSessionsResponse {
  version: string;
  sessions: OcSession[];
}

export type OcContentPart =
  | { type: "text"; text?: string }
  | { type: "reasoning"; text?: string }
  | {
      type: "tool";
      id?: string;
      name?: string;
      executed?: boolean;
      state?: {
        status?: string;
        input?: unknown;
        content?: unknown;
        metadata?: unknown;
      };
    };

/** One message. `type` discriminates: `user`, `assistant`, `idle`, … */
export interface OcMessage {
  id: string;
  type: string;
  time?: OcTime;
  /** `user` */
  text?: string;
  files?: unknown[];
  /** `assistant` */
  agent?: string;
  model?: OcModel;
  content?: OcContentPart[];
}

export interface OcMessagesResponse {
  data: OcMessage[];
  cursor?: unknown;
}

/** A pending permission request. */
/** Where a permission request came from: the tool call it gates. */
export interface OcPermissionSource {
  type: "tool";
  messageID: string;
  /** The id of the tool call inside that message. */
  id: string;
}

export interface OcPermission {
  id: string;
  sessionID: string;
  action?: string;
  resources?: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  message?: string;
  source?: OcPermissionSource;
}

/** A condition that controls whether a form field is shown. */
export interface OcFormWhen {
  key: string;
  op: "eq" | "neq";
  value: string | number | boolean;
}

/** One field of a form. */
export interface OcFormField {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: OcFormWhen[];
  type: string;
  options?: Array<{ value?: string; label?: string }>;
}

/** A pending form (opencode v2's ask-the-user mechanism). */
export interface OcForm {
  id: string;
  sessionID: string;
  title?: string;
  metadata?: Record<string, unknown>;
  fields: OcFormField[];
}
