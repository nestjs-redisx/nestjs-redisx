import { describe, it, expect } from 'vitest';

describe('MsgpackSerializer', () => {
  describe('constructor', () => {
    it('should throw error when msgpackr is not installed', () => {
      // Given/When/Then
      try {
        // Dynamically import to isolate the error
        const { MsgpackSerializer } = require('../../src/serializers/msgpack.serializer');
        new MsgpackSerializer();
        expect.fail('Should have thrown error');
      } catch (error) {
        // Error could be module not found or msgpackr package error
        expect((error as Error).message).toMatch(/msgpackr|module/i);
      }
    });
  });
});
