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
  /** A value the text needs: `sgfUnsupportedSize`'s board size, such as `19x13`. */
  readonly detail: string | undefined;

  constructor(code: ErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.detail = detail;
  }
}

// A Record keyed by ErrorCode, so a new code generated from Rust fails type checking until listed.
const KNOWN_CODES: Record<ErrorCode, true> = {
  internal: true,
  engineNotConfigured: true,
  engineNotRunning: true,
  setupUnknownEngine: true,
  setupBusy: true,
  setupUnknownNetwork: true,
  setupImportFailed: true,
  setupInvalidSource: true,
  engineBusy: true,
  invalidPosition: true,
  sgfNotAGame: true,
  sgfNotGo: true,
  sgfUnsupportedSize: true,
  sgfTooLarge: true,
  gameEmpty: true,
  fileReadFailed: true,
  fileWriteFailed: true,
  fileNotSgf: true,
  fileMissing: true,
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
    const { code, message, detail } = error as {
      code?: unknown;
      message?: unknown;
      detail?: unknown;
    };
    if (isKnownCode(code) && typeof message === 'string') {
      return new TransportError(code, message, typeof detail === 'string' ? detail : undefined);
    }
  }
  return new TransportError('internal', describe(error));
}
