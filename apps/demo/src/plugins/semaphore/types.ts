/**
 * Shared stubs for semaphore snippet files.
 */

export abstract class VideoEncoder {
  abstract encode(videoId: string): Promise<void>;
}

export abstract class LegacyApiClient {
  abstract fetchReport(tenantId: string): Promise<unknown>;
}
