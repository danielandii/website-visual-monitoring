import type { BlockType, FailureCategory, LatestStatus } from "~/db/schema";

export type WebsiteBlock = {
  type: BlockType;
  provider: string | null;
  evidence: string[];
};

export type CheckOutcome = {
  status: LatestStatus;
  failureCategory: FailureCategory | null;
  block?: WebsiteBlock | null;
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
