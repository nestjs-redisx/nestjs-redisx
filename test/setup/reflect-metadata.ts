/**
 * Shared Vitest setup: load reflect-metadata before any spec runs.
 *
 * Under NestJS ≤ 11 the CJS @nestjs/testing pulled reflect-metadata in
 * transitively early enough for decorated specs; the ESM Nest 12 build does
 * not, so `Test.createTestingModule` fails without an explicit import. Kept
 * unconditional — the import is idempotent and harmless on Nest 10/11.
 */
import 'reflect-metadata';
