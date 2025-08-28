const { getPreset, getAllPresets } = require('../src/utils/presets');

describe('Presets Utils', () => {
  describe('getAllPresets', () => {
    test('should return all 6 presets', () => {
      const presets = getAllPresets();
      expect(presets).toHaveLength(6);
      
      const expectedIds = ['new_do', 'cheese_please', 'cartoon_me', 'teleport_me', 'specs_appeal', 'spirit_animal'];
      const actualIds = presets.map(p => p.id);
      
      expectedIds.forEach(id => {
        expect(actualIds).toContain(id);
      });
    });

    test('should return presets with required properties', () => {
      const presets = getAllPresets();
      
      presets.forEach(preset => {
        expect(preset).toHaveProperty('id');
        expect(preset).toHaveProperty('name');
        expect(preset).toHaveProperty('description');
        expect(preset).toHaveProperty('prompt');
        
        expect(typeof preset.id).toBe('string');
        expect(typeof preset.name).toBe('string');
        expect(typeof preset.description).toBe('string');
        expect(typeof preset.prompt).toBe('string');
      });
    });
  });

  describe('getPreset', () => {
    test('should return correct preset for valid ID', () => {
      const preset = getPreset('new_do');
      
      expect(preset).toBeDefined();
      expect(preset.name).toBe('New \'Do');
      expect(preset.description).toBe('Upgraded hairstyle');
      expect(preset.prompt).toContain('hairstyle');
    });

    test('should return undefined for invalid ID', () => {
      const preset = getPreset('invalid_preset');
      expect(preset).toBeUndefined();
    });

    test('should handle null/undefined input', () => {
      expect(getPreset(null)).toBeUndefined();
      expect(getPreset(undefined)).toBeUndefined();
    });
  });
});