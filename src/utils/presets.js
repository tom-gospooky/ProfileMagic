const PRESETS = {
  'new_do': {
    name: 'New \'Do',
    description: 'Upgraded hairstyle',
    prompt: 'Give this person a stylish new hairstyle, keeping their face and features identical but updating their hair to look modern and trendy'
  },
  'cheese_please': {
    name: 'Cheese Please',
    description: 'Friendlier, smiling expression',
    prompt: 'Make this person smile naturally and warmly, adjusting their facial expression to look friendlier and more approachable'
  },
  'cartoon_me': {
    name: 'Cartoon Me',
    description: 'Toon/comic transformation',
    prompt: 'Transform this photo into a cartoon or comic book style while maintaining the person\'s recognizable features'
  },
  'teleport_me': {
    name: 'Teleport Me',
    description: 'Background swap (fun location)',
    prompt: 'Replace the background with an interesting location like a tropical beach, mountain vista, or futuristic cityscape while keeping the person unchanged'
  },
  'specs_appeal': {
    name: 'Specs Appeal',
    description: 'Add funny glasses',
    prompt: 'Add stylish or funny glasses to this person\'s face, choosing frames that complement their features'
  },
  'spirit_animal': {
    name: 'Spirit Animal',
    description: 'Subtle animal companion overlay',
    prompt: 'Add a small, cute animal companion (like a cat, bird, or dog) somewhere in the image in a natural way'
  }
};

function getPreset(presetId) {
  return PRESETS[presetId];
}

function getAllPresets() {
  return Object.keys(PRESETS).map(id => ({
    id,
    ...PRESETS[id]
  }));
}

module.exports = {
  PRESETS,
  getPreset,
  getAllPresets
};