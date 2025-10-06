const { GoogleGenAI } = require('@google/genai');
const slackService = require('./slack');
const fileServer = require('./fileServer');
const axios = require('axios');
const { logSlackError } = require('../utils/logging');
const { IMAGE_SIZE_LIMITS, API_RETRY, TIMEOUTS, LIMITS } = require('../constants/imageProcessing');

async function compressIfLarge(buffer, mimeType = 'image/jpeg', maxBytes = IMAGE_SIZE_LIMITS.GEMINI_MAX_BYTES, options = {}) {
  try {
    // If already small enough and JPEG, keep as-is
    if (buffer.length <= maxBytes && mimeType === 'image/jpeg') return { buffer, mimeType };

    const Jimp = require('jimp');
    let image = await Jimp.read(buffer);

    // Initial constraints
    let maxSide = options.maxSide || 2048;
    let quality = options.initialQuality || 85;
    const minQuality = options.minQuality || 40;
    const minSide = options.minSide || 800;
    let attempts = 0;
    const maxAttempts = options.maxAttempts || 8;

    // Apply an initial downscale if needed
    if (image.getWidth() > maxSide || image.getHeight() > maxSide) {
      image = image.scaleToFit(maxSide, maxSide);
    }

    let out = await image.quality(quality).getBufferAsync(Jimp.MIME_JPEG);

    while (out.length > maxBytes && attempts < maxAttempts) {
      attempts += 1;
      // Decrease quality first, then dimensions if needed
      if (quality > minQuality) {
        quality = Math.max(minQuality, quality - 10);
      } else if (image.getWidth() > minSide || image.getHeight() > minSide) {
        maxSide = Math.max(minSide, Math.floor(maxSide * 0.8));
        // re-read from original buffer to avoid multiple re-encodes stacking artifacts
        image = await Jimp.read(buffer);
        image = image.scaleToFit(maxSide, maxSide);
      } else {
        break; // can't reduce further
      }
      out = await image.quality(quality).getBufferAsync(Jimp.MIME_JPEG);
    }

    return { buffer: out, mimeType: 'image/jpeg' };
  } catch (e) {
    console.warn('Compression skipped due to error:', e.message);
    return { buffer, mimeType };
  }
}

async function externalUploadAsSlackFile(client, imageBuffer, filename, userId) {
  // Try external upload with proactive compression for large buffers and stronger 413 handling
  try {
    let toUpload = imageBuffer;
    // If very large upfront, proactively compress with modest downscaling
    if (toUpload.length > IMAGE_SIZE_LIMITS.PROACTIVE_COMPRESS_THRESHOLD) {
      const c = await compressIfLarge(toUpload, 'image/jpeg', IMAGE_SIZE_LIMITS.PROACTIVE_COMPRESS_TARGET, { maxSide: 1600, minSide: 900 });
      toUpload = c.buffer;
    }

    const first = await client.files.getUploadURLExternal({ filename, length: toUpload.length });
    await axios.put(first.upload_url, toUpload, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': toUpload.length }
    });
    // Complete without sharing to any conversation (no message created)
    const complete = await client.files.completeUploadExternal({ files: [{ id: first.file_id, title: filename }] });
    const created = complete.files?.[0] || { id: first.file_id };
    // Fetch full info to obtain stable permalinks
    try {
      const info = await client.files.info({ file: created.id });
      const file = info?.file ? { ...created, ...info.file } : created;
      return { ok: true, file };
    } catch (_) {
      return { ok: true, file: created };
    }
  } catch (err) {
    const status = err?.response?.status || err?.status;
    if (status === 413) {
      // Compress and retry with aggressive compression target and smaller max side
      try {
        const { buffer: smaller } = await compressIfLarge(imageBuffer, 'image/jpeg', IMAGE_SIZE_LIMITS.RETRY_COMPRESS_TARGET, { maxSide: 1280, minSide: 720 });
        const retry = await client.files.getUploadURLExternal({ filename, length: smaller.length });
        await axios.put(retry.upload_url, smaller, {
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': smaller.length }
        });
        const complete = await client.files.completeUploadExternal({ files: [{ id: retry.file_id, title: filename }] });
        const created = complete.files?.[0] || { id: retry.file_id };
        try {
          const info = await client.files.info({ file: created.id });
          const file = info?.file ? { ...created, ...info.file } : created;
          return { ok: true, file };
        } catch (_) {
          return { ok: true, file: created };
        }
      } catch (err2) {
        logSlackError('externalUploadRetry', err2);
        return { ok: false, error: err2 };
      }
    }
    logSlackError('externalUpload', err);
    return { ok: false, error: err };
  }
}

// Helper to call Gemini with retries and model fallbacks
function thresholdFromEnv(value) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim().toLowerCase();
  // Friendly synonyms
  if (['none', 'off', 'disabled', 'disable', 'lenient', 'lowest', 'no_filter', 'no-filter'].includes(v)) return 'BLOCK_NONE';
  if (['only_high', 'only-high', 'onlyhigh'].includes(v)) return 'BLOCK_ONLY_HIGH';
  if (['low', 'strict', 'lowest_allow', 'lowest-allow'].includes(v)) return 'BLOCK_LOW_AND_ABOVE';
  if (['medium', 'med'].includes(v)) return 'BLOCK_MEDIUM_AND_ABOVE';
  if (v === 'high') return 'BLOCK_HIGH_AND_ABOVE';
  if (['default', 'sdk_default', 'sdk-default'].includes(v)) return '__SDK_DEFAULT__';
  return null;
}

function getSafetySettingsFromEnv() {
  // Base preference; default to no moderation (BLOCK_NONE) unless explicitly set to SDK default
  const baseRaw = thresholdFromEnv(process.env.GEMINI_SAFETY);
  const perCatRaw = {
    HARM_CATEGORY_VIOLENCE: thresholdFromEnv(process.env.GEMINI_SAFETY_VIOLENCE),
    HARM_CATEGORY_SEXUAL: thresholdFromEnv(process.env.GEMINI_SAFETY_SEXUAL),
    HARM_CATEGORY_HATE_SPEECH: thresholdFromEnv(process.env.GEMINI_SAFETY_HATE),
    HARM_CATEGORY_HARASSMENT: thresholdFromEnv(process.env.GEMINI_SAFETY_HARASSMENT),
    HARM_CATEGORY_DANGEROUS_CONTENT: thresholdFromEnv(process.env.GEMINI_SAFETY_DANGEROUS)
  };

  // If any setting explicitly requests SDK defaults, return null (let server decide)
  if (baseRaw === '__SDK_DEFAULT__' || Object.values(perCatRaw).includes('__SDK_DEFAULT__')) {
    return null;
  }

  // Default base is BLOCK_NONE for leniency
  const base = baseRaw || 'BLOCK_NONE';
  const cats = Object.keys(perCatRaw);
  const settings = cats.map(cat => ({ category: cat, threshold: perCatRaw[cat] || base }));
  return settings;
}

async function callGeminiWithRetry(ai, contentParts, isProduction) {
  const safetySettings = getSafetySettingsFromEnv();
  const defaultModels = [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ];
  const models = (process.env.GEMINI_MODEL_FALLBACKS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const modelList = [...new Set([...defaultModels, ...models])];

  for (const modelName of modelList) {
    for (let attempt = 1; attempt <= API_RETRY.MAX_ATTEMPTS; attempt++) {
      try {
        if (!isProduction) console.log(`Gemini call: model=${modelName} attempt=${attempt}`);
        // Pattern 1
        try {
          // Prefer direct call with safety settings (most flexible)
          return await ai.generateContent({ model: modelName, contents: [{ parts: contentParts }], ...(safetySettings ? { safetySettings } : {}) });
        } catch (e1) {
          if (!isProduction) console.log('ai.generateContent failed:', e1.message);
          try {
            // Next: bind model with safety settings, then call with options
            const model = ai.getGenerativeModel({ model: modelName, ...(safetySettings ? { safetySettings } : {}) });
            return await model.generateContent({ contents: [{ parts: contentParts }] });
          } catch (e2) {
            if (!isProduction) console.log('getGenerativeModel + generateContent failed:', e2.message);
            // Last resort legacy shape
            return await ai.models.generateContent({ model: modelName, contents: [{ parts: contentParts }], ...(safetySettings ? { safetySettings } : {}) });
          }
        }
      } catch (err) {
        const status = err?.status || err?.code || err?.response?.status;
        const internal = /INTERNAL|UNAVAILABLE|DEADLINE|500/.test(String(status)) || /INTERNAL/.test(err?.message || '');
        if (!isProduction) console.warn(`Gemini error on model=${modelName} attempt=${attempt}:`, err?.message || err);
        if (attempt < API_RETRY.MAX_ATTEMPTS && internal) {
          const backoff = API_RETRY.BACKOFF_BASE_MS * attempt;
          await new Promise(r => setTimeout(r, backoff));
          continue; // retry same model
        }
        // Move to next model
      }
    }
  }
  throw new Error('GENERATION_FAILED');
}

// Helper function to convert Buffer to the format Gemini expects
const bufferToPart = (buffer, mimeType = 'image/jpeg') => {
  const base64Data = buffer.toString('base64');
  
  return {
    inlineData: {
      mimeType,
      data: base64Data
    }
  };
};

const handleApiResponse = async (response, context = 'edit', client, userId, channelId = null) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!isProduction) {
    console.log('=== GEMINI API RESPONSE DEBUG ===');
    console.log('Response structure:', Object.keys(response || {}));
    console.log('Candidates:', response.candidates?.length || 'none');
    if (response.candidates?.[0]) {
      console.log('First candidate keys:', Object.keys(response.candidates[0]));
      console.log('Finish reason:', response.candidates[0].finishReason);
      console.log('Content parts:', response.candidates[0].content?.parts?.length || 'none');
    }
    console.log('Prompt feedback:', response.promptFeedback || 'none');
    console.log('=== END DEBUG ===');
  }
  
  // Check for prompt blocking first
  if (response.promptFeedback?.blockReason) {
    const { blockReason, blockReasonMessage } = response.promptFeedback;
    console.error('API request blocked (prompt):', blockReason);
    const error = new Error('CONTENT_BLOCKED');
    error.reason = blockReason;
    error.userMessage = 'Your prompt was blocked by content safety filters.' + (blockReasonMessage ? `\n\n${blockReasonMessage}` : '');
    throw error;
  }

  // Try to find the image part
  const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

  if (imagePartFromResponse?.inlineData) {
    const { mimeType, data } = imagePartFromResponse.inlineData;
    if (!isProduction) console.log(`Received image data (${mimeType}) for ${context}`);
    // Convert base64 to buffer and save as a temporary file served by our file server
    const imageBuffer = Buffer.from(data, 'base64');
    const filename = `edited_${Date.now()}.jpg`;
    const fileUrl = await fileServer.saveTemporaryFile(imageBuffer, filename);
    if (!isProduction) console.log(`Saved edited image locally: ${fileUrl}`);
    return { fileId: null, localUrl: fileUrl, slackFile: null, origin: 'local' };
  }

  // If no image, check for other reasons
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    console.error('Image generation blocked:', finishReason);
    
    if (finishReason === 'PROHIBITED_CONTENT') {
      const error = new Error('CONTENT_BLOCKED');
      error.reason = 'PROHIBITED_CONTENT';
      error.userMessage = 'Your prompt was blocked by content safety filters. Please try a different, more neutral prompt.';
      throw error;
    } else {
      const error = new Error('GENERATION_FAILED');
      error.reason = finishReason;
      error.userMessage = `Image generation failed (${finishReason}). Please try rephrasing your prompt.`;
      throw error;
    }
  }
  
  const textFeedback = response.text?.trim();
  const errorMessage = `The AI model did not return an image for the ${context}. ` + 
      (textFeedback 
        ? `The model responded with text: "${textFeedback}"`
        : 'This can happen due to safety filters or if the request is too complex. Please try rephrasing your prompt to be more direct.');

  console.error(`No image in API response for ${context}`);
  throw new Error(errorMessage);
};

async function editImage(imageUrl, prompt, client, userId, referenceImageUrl = null, channelId = null) {
  const isProduction = process.env.NODE_ENV === 'production';
  
  try {
    if (!isProduction) console.log(`Starting image edit with prompt: "${prompt}"`);
    if (referenceImageUrl && !isProduction) console.log(`Using reference image: ${referenceImageUrl}`);
    
    // Initialize Gemini AI
    const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
    
    // Debug: log available methods (dev only)
    if (!isProduction) {
      console.log('GoogleGenAI instance methods:', Object.getOwnPropertyNames(ai));
      console.log('GoogleGenAI prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(ai)));
    }
    
    // Download the original image
    const original = await slackService.downloadImageWithMime(imageUrl);
    // Compress/normalize before sending to Gemini to reduce 500s from oversized payloads
    const maxBytesGemini = Number(process.env.GEMINI_MAX_BYTES || IMAGE_SIZE_LIMITS.GEMINI_MAX_BYTES);
    const pre = await compressIfLarge(original.buffer, original.mimeType || 'image/jpeg', maxBytesGemini);
    const imageBuffer = pre.buffer;
    const originalMime = pre.mimeType || 'image/jpeg';
    if (!isProduction) console.log(`Downloaded original image, size: ${imageBuffer.length} bytes, type: ${originalMime}`);
    
    // Convert to the format Gemini expects
    const originalImagePart = bufferToPart(imageBuffer, originalMime);
    
    // Download and convert reference image if provided
    let referenceImagePart = null;
    if (referenceImageUrl) {
      try {
        const ref = await slackService.downloadImageWithMime(referenceImageUrl);
        const refPre = await compressIfLarge(ref.buffer, ref.mimeType || 'image/jpeg', maxBytesGemini);
        const referenceBuffer = refPre.buffer;
        const referenceMime = refPre.mimeType || 'image/jpeg';
        referenceImagePart = bufferToPart(referenceBuffer, referenceMime);
        if (!isProduction) console.log(`Downloaded reference image, size: ${referenceBuffer.length} bytes, type: ${referenceMime}`);
      } catch (refError) {
        console.error('Failed to download reference image:', refError.message);
        // Continue without reference image
      }
    }
    
    // Create a prompt that includes reference image instructions if available
    let editPrompt;
    if (referenceImagePart) {
      editPrompt = `${prompt}`;
    } else {
      editPrompt = `${prompt}`;
    }

    const textPart = { text: editPrompt };

    if (!isProduction) {
      console.log('Sending image and prompt to Gemini 2.5 Flash Image Preview...');
      console.log('API call details:', {
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
        partsCount: 2,
        imageSize: imageBuffer.length
      });
    }
    
    // Prepare content parts for API call
    const baseParts = [originalImagePart];
    if (referenceImagePart) baseParts.push(referenceImagePart);

    // Helper to attempt generation with provided text
    const attempt = async (text) => {
      const parts = [...baseParts, { text }];
      const response = await callGeminiWithRetry(ai, parts, isProduction);
      if (!isProduction) console.log('Received response from Gemini API');
      return handleApiResponse(response, 'edit', client, userId, channelId);
    };

    // First attempt
    try {
      return await attempt(editPrompt);
    } catch (e) {
      // Single safe retry for IMAGE_SAFETY
      if (e && e.message === 'GENERATION_FAILED' && (e.reason === 'IMAGE_SAFETY' || /IMAGE_SAFETY/.test(String(e.reason)))) {
        const safePrompt = `${editPrompt} Please ensure the result is family-friendly, workplace-safe, fully clothed, and contains no gore, weapons, or offensive imagery.`;
        if (!isProduction) console.warn('Retrying with safe prompt due to IMAGE_SAFETY');
        return await attempt(safePrompt);
      }
      throw e;
    }

  } catch (error) {
    console.error('editImage error:', error.constructor.name, error.message);
    if (!isProduction) {
      console.error('Full stack trace:', error.stack);
    }
    
    // Re-throw known content blocking errors to show user proper message
    if (error.message === 'CONTENT_BLOCKED' || error.message === 'GENERATION_FAILED') {
      throw error;
    }
    
    // For other API errors, show generic failure
    if (!isProduction) console.warn('Falling back due to API error');
    throw new Error('Failed to process your image. Please try again.');
  }
}

// New: Edit a group of images together in a single Gemini call
async function editImageGroup(imageUrls, prompt, client, userId, channelId = null) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!imageUrls || imageUrls.length === 0) {
    throw new Error('No images provided for group editing');
  }

  try {
    if (!isProduction) console.log(`Starting group edit of ${imageUrls.length} images with prompt: "${prompt}"`);

    const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

    // Prepare content parts from all images (compress where needed)
    const contentParts = [];
    for (const url of imageUrls) {
      try {
        const { buffer, mimeType } = await slackService.downloadImageWithMime(url);
        const maxBytesGemini = Number(process.env.GEMINI_MAX_BYTES || IMAGE_SIZE_LIMITS.GEMINI_MAX_BYTES);
        const pre = await compressIfLarge(buffer, mimeType || 'image/jpeg', maxBytesGemini);
        contentParts.push(bufferToPart(pre.buffer, pre.mimeType || 'image/jpeg'));
      } catch (e) {
        console.error('Failed to download image for group edit:', e.message);
        throw new Error('Failed to download one of the images');
      }
    }

    contentParts.push({ text: `${prompt}` });

    const response = await callGeminiWithRetry(ai, contentParts, isProduction);
    if (!isProduction) console.log('Received group response from Gemini API');
    return await handleApiResponse(response, 'edit', client, userId, channelId);

  } catch (error) {
    console.error('editImageGroup error:', error.constructor.name, error.message);
    if (!isProduction) console.error('Full stack trace:', error.stack);
    throw new Error('Failed to process your images. Please try again.');
  }
}

// Alternative implementation using a mock/placeholder service for development
async function editImageMock(imageUrl, prompt) {
  const isProduction = process.env.NODE_ENV === 'production';
  try {
    if (!isProduction) console.log(`Mock editing image with prompt: "${prompt}"`);
    
    // For demo purposes, let's use different placeholder images based on the prompt
    let placeholderUrl;
    
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('cartoon') || lowerPrompt.includes('anime')) {
      // Use a cartoon placeholder
      placeholderUrl = 'https://via.placeholder.com/512x512/FFB6C1/000000?text=Cartoon+Style';
    } else if (lowerPrompt.includes('sunglasses') || lowerPrompt.includes('glasses')) {
      // Use a sunglasses placeholder
      placeholderUrl = 'https://via.placeholder.com/512x512/87CEEB/000000?text=With+Sunglasses';
    } else if (lowerPrompt.includes('bird') || lowerPrompt.includes('animal')) {
      // Use an animal-themed placeholder
      placeholderUrl = 'https://via.placeholder.com/512x512/98FB98/000000?text=With+Bird';
    } else if (lowerPrompt.includes('hat') || lowerPrompt.includes('cap')) {
      // Use a hat placeholder
      placeholderUrl = 'https://via.placeholder.com/512x512/DDA0DD/000000?text=With+Hat';
    } else {
      // Generic edit placeholder
      placeholderUrl = 'https://via.placeholder.com/512x512/F0E68C/000000?text=AI+Edited';
    }
    
    try {
      // Download the placeholder image
      const imageBuffer = await slackService.downloadImage(placeholderUrl);
      const timestamp = Date.now();
      const filename = `mock_edited_${timestamp}.jpg`;
      const fileUrl = await fileServer.saveTemporaryFile(imageBuffer, filename);
      
      if (!isProduction) console.log(`Created mock edited image: ${fileUrl}`);
      return fileUrl;
      
    } catch (downloadError) {
      console.error('Placeholder download failed, using original');
      return imageUrl;
    }

  } catch (error) {
    console.error('Mock image editing error:', error.message);
    return imageUrl;
  }
}

// Export the real function - we want to test the actual Gemini API
const editImageFunction = editImage;

async function editMultipleImages(imageUrls, prompt, client, userId, referenceImageUrl = null, channelId = null) {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!imageUrls || imageUrls.length === 0) {
    throw new Error('No images provided for editing');
  }

  console.log(`Starting batch edit for ${imageUrls.length} images with prompt: "${prompt}"`);

  const results = [];

  // Process images sequentially to avoid overwhelming the API
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    try {
      console.log(`Processing image ${i + 1}/${imageUrls.length}: ${imageUrl}`);
      const result = await editImage(imageUrl, prompt, client, userId, referenceImageUrl, channelId);
      results.push({
        success: true,
        originalUrl: imageUrl,
        result: result,
        index: i
      });
    } catch (error) {
      console.error(`Failed to edit image ${i + 1}:`, error.message);
      results.push({
        success: false,
        originalUrl: imageUrl,
        error: error.message,
        index: i
      });
    }
  }

  // Return summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Batch edit complete: ${successful.length} successful, ${failed.length} failed`);

  return {
    total: imageUrls.length,
    successful: successful.length,
    failed: failed.length,
    results: results
  };
}

module.exports = {
  editImage: editImageFunction,
  editImageMock,
  editImageReal: editImage,
  editMultipleImages,
  editImageGroup
};
