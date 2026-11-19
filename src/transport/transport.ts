import type { AppEvent } from './generated/AppEvent';
import type { ErrorCode } from './generated/ErrorCode';
import type { Request } from './generated/Request';
import type { Response } from './generated/Response';

/**
 * The only way the UI talks to the engine side (charter section 6.1). Tauri IPC implements it
 * locally; Phase 3 adds a WebSocket implementation carrying the same messages.
 */
export interface Transport {
  request(request: Request): Promise<Response>;
  /** Receives events the engine side pushes. Returns a function that stops delivery. */
  subscribe(listener: (event: AppEvent) => void): () => void;
}

/** A failed request. Show text looked up from `code`; `message` is for logs only. */
export class TransportError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
  }
}

// A Record keyed by ErrorCode, so a new code generated from Rust fails type checking until listed.
const KNOWN_CODES: Record<ErrorCode, true> = {
  internal: true,
  engineNotConfigured: true,
  engineNotRunning: true,
};

function isKnownCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(KNOWN_CODES, value);
}

function describe(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Normalises anything a transport can reject with into a TransportError. */
export function toTransportError(error: unknown): TransportError {
  if (error instanceof TransportError) return error;
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (isKnownCode(code) && typeof message === 'string') return new TransportError(code, message);
  }
  return new TransportError('internal', describe(error));
}
