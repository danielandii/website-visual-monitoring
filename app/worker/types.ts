import type { BlockType, CompromiseFinding, CompromiseResult, FailureCategory, LatestStatus } from "~/db/schema";

export type WebsiteBlock = {
  type: BlockType;
  provider: string | null;
  evidence: string[];
};

export type CompromiseCheck = {
  result: Exclude<CompromiseResult, "NOT_CHECKED">;
  findings: CompromiseFinding[];
  /** Third-party script and hidden-frame sites seen, learned as Known Script Sources on the first examined check. */
  thirdPartySources: string[];
};

export type CheckOutcome = {
  status: LatestStatus;
  failureCategory: FailureCategory | null;
  block?: WebsiteBlock | null;
  /** Absent when the page could not be examined (not loaded, error response, or a Website Block). */
  compromise?: CompromiseCheck | null;
  summary: string;
  signals: string[];
  httpStatus: number | null;
  finalUrl: string | null;
  durationMs: number;
  screenshot?: Buffer;
  pageTitle?: string;
  visibleTextSample?: string;
  aiClassification?: string | null;
  aiConfidence?: number | null;
};

export type AiInput = {
  screenshot: Buffer;
  urlHost: string;
  httpStatus: number | null;
  pageTitle: string;
  visibleTextSample: string;
  suspicionSignals: string[];
};

export type AiOutput = {
  classification: "OK" | "VISUAL_BROKEN" | "ERROR_PAGE" | "BLANK";
  confidence: number;
  reason: string;
};
