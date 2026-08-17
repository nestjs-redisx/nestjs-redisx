import { describe, it, expect } from 'vitest';

import { validateSessionConfig } from '../../src/session/domain/validate-session-config';
import { InvalidSessionConfigError } from '../../src/shared/errors';
import type { IValidatableSessionConfig } from '../../src/session/domain/validate-session-config';

function validConfig(overrides: Partial<IValidatableSessionConfig> = {}): IValidatableSessionConfig {
  return {
    keyPrefix: 'sess:',
    defaultTtlMs: 86_400_000,
    maxSessionsPolicy: 'evict-oldest',
    userIdExtractor: () => undefined,
    ...overrides,
  };
}

describe('validateSessionConfig', () => {
  it('should accept a minimal valid config', () => {
    // When / Then
    expect(() => validateSessionConfig(validConfig())).not.toThrow();
  });

  it('should accept optional limits when they are positive integers', () => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ absoluteLifetimeMs: 43_200_000, maxSessionsPerUser: 5 }))).not.toThrow();
  });

  it('should throw when keyPrefix is empty', () => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ keyPrefix: '' }))).toThrow(InvalidSessionConfigError);
  });

  it.each(['ses{s}:', '{app}:', 'a}b:'])('should throw when keyPrefix %j contains braces (cluster hash-tag safety)', (keyPrefix) => {
    // Given: braces in the prefix create an empty/foreign hash tag, splitting
    // payload and metadata across cluster slots for EVERY session

    // When / Then
    expect(() => validateSessionConfig(validConfig({ keyPrefix }))).toThrow(InvalidSessionConfigError);
  });

  it.each([1e21, Number.MAX_SAFE_INTEGER])('should throw when defaultTtlMs is the absurd value %s', (defaultTtlMs) => {
    // Given: values >= 1e21 stringify in exponent notation and abort PEXPIRE
    // mid-script AFTER the payload SET (immortal key)

    // When / Then
    expect(() => validateSessionConfig(validConfig({ defaultTtlMs }))).toThrow(InvalidSessionConfigError);
  });

  it.each([1e21, Number.MAX_SAFE_INTEGER])('should throw when absoluteLifetimeMs is the absurd value %s', (absoluteLifetimeMs) => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ absoluteLifetimeMs }))).toThrow(InvalidSessionConfigError);
  });

  it.each([0, -1, 1.5, NaN, Infinity])('should throw when defaultTtlMs is %s', (defaultTtlMs) => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ defaultTtlMs }))).toThrow(InvalidSessionConfigError);
  });

  it.each([0, -100, 0.5, NaN])('should throw when absoluteLifetimeMs is %s', (absoluteLifetimeMs) => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ absoluteLifetimeMs }))).toThrow(InvalidSessionConfigError);
  });

  it.each([0, -1, 2.5, NaN])('should throw when maxSessionsPerUser is %s', (maxSessionsPerUser) => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ maxSessionsPerUser }))).toThrow(InvalidSessionConfigError);
  });

  it('should throw when maxSessionsPolicy is not a known policy', () => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ maxSessionsPolicy: 'drop-newest' as never }))).toThrow(InvalidSessionConfigError);
  });

  it('should throw when userIdExtractor is not a function', () => {
    // When / Then
    expect(() => validateSessionConfig(validConfig({ userIdExtractor: 'nope' as never }))).toThrow(InvalidSessionConfigError);
  });
});
