const { validatePrompt, validateImageUrl, validateSlackUserId } = require('../src/utils/validation');

describe('Validation Utils', () => {
  describe('validatePrompt', () => {
    test('should accept valid prompts', () => {
      const result = validatePrompt('Add sunglasses to my face');
      expect(result.valid).toBe(true);
      expect(result.prompt).toBe('Add sunglasses to my face');
    });

    test('should reject empty prompts', () => {
      const result = validatePrompt('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('should reject null/undefined prompts', () => {
      const result1 = validatePrompt(null);
      const result2 = validatePrompt(undefined);
      expect(result1.valid).toBe(false);
      expect(result2.valid).toBe(false);
    });

    test('should reject overly long prompts', () => {
      const longPrompt = 'a'.repeat(501);
      const result = validatePrompt(longPrompt);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('500 characters');
    });

    test('should reject inappropriate content', () => {
      const result = validatePrompt('make me look nude');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('inappropriate');
    });
  });

  describe('validateImageUrl', () => {
    test('should accept valid HTTP URLs', () => {
      const result = validateImageUrl('https://example.com/image.jpg');
      expect(result.valid).toBe(true);
    });

    test('should reject invalid URLs', () => {
      const result = validateImageUrl('not-a-url');
      expect(result.valid).toBe(false);
    });

    test('should reject non-HTTP protocols', () => {
      const result = validateImageUrl('ftp://example.com/image.jpg');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateSlackUserId', () => {
    test('should accept valid Slack user IDs', () => {
      const result = validateSlackUserId('U1234567890');
      expect(result.valid).toBe(true);
    });

    test('should reject invalid Slack user IDs', () => {
      const result = validateSlackUserId('invalid-id');
      expect(result.valid).toBe(false);
    });

    test('should reject empty user IDs', () => {
      const result = validateSlackUserId('');
      expect(result.valid).toBe(false);
    });
  });
});