const { GoogleGenAI } = require('@google/genai');
const slackService = require('./slack');
const fileServer = require('./fileServer');
const axios = require('axios');
const { logSlackError } = require('../utils/logging');

async function compressIfLarge(buffer, mimeType = 'image/jpeg', maxBytes = 4 * 1024 * 1024, options = {}) {
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
    // If very large upfront (>7MB), proactively compress to ~3MB with modest downscaling
    if (toUpload.length > 7 * 1024 * 1024) {
      const c = await compressIfLarge(toUpload, 'image/jpeg', 3 * 1024 * 1024, { maxSide: 1600, minSide: 900 });
      toUpload = c.buffer;
    }

    const first = await client.files.getUploadURLExternal({ filename, length: toUpload.length });
    await axios.put(first.upload_url, toUpload, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': toUpload.length }
    });
    // Complete without sharing to any conversation (no message created)
    const complete = await client.files.completeUploadExternal({ files: [{ id: first.file_id, title: filename }] });
    const created = complete.files?.[0] || { id: first.file_id };
    return { ok: true, file: created };
  } catch (err) {
    const status = err?.response?.status || err?.status;
    if (status === 413) {
      // Compress and retry with stricter target (~2MB) and smaller max side
      try {
        const { buffer: smaller } = await compressIfLarge(imageBuffer, 'image/jpeg', 2 * 1024 * 1024, { maxSide: 1280, minSide: 720 });
        const retry = await client.files.getUploadURLExternal({ filename, length: smaller.length });
        await axios.put(retry.upload_url, smaller, {
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': smaller.length }
        });
        const complete = await client.files.completeUploadExternal({ files: [{ id: retry.file_id, title: filename }] });
        const created = complete.files?.[0] || { id: retry.file_id };
        return { ok: true, file: created };
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
async function callGeminiWithRetry(ai, contentParts, isProduction) {
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
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if (!isProduction) console.log(`Gemini call: model=${modelName} attempt=${attempt}`);
        // Pattern 1
        try {
          const model = ai.getGenerativeModel({ model: modelName });
          return await model.generateContent(contentParts);
        } catch (e1) {
          if (!isProduction) console.log('getGenerativeModel failed:', e1.message);
          try {
            // Pattern 2
            return await ai.generateContent({ model: modelName, contents: [{ parts: contentParts }] });
          } catch (e2) {
            if (!isProduction) console.log('direct generateContent failed:', e2.message);
            // Pattern 3
            return await ai.models.generateContent({ model: modelName, contents: [{ parts: contentParts }] });
          }
        }
      } catch (err) {
        const status = err?.status || err?.code || err?.response?.status;
        const internal = /INTERNAL|UNAVAILABLE|DEADLINE|500/.test(String(status)) || /INTERNAL/.test(err?.message || '');
        if (!isProduction) console.warn(`Gemini error on model=${modelName} attempt=${attempt}:`, err?.message || err);
        if (attempt < maxAttempts && internal) {
          const backoff = 400 * attempt;
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
    const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
    console.error('API request blocked:', blockReason);
    throw new Error(errorMessage);
  }

  // Try to find the image part
  const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

  if (imagePartFromResponse?.inlineData) {
    const { mimeType, data } = imagePartFromResponse.inlineData;
    if (!isProduction) console.log(`Received image data (${mimeType}) for ${context}`);
    
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(data, 'base64');
    const filename = `edited_${Date.now()}.jpg`;
    
    // Prefer external unshared upload first to avoid auto-creating a DM/channel message
      try {
        const extFirst = await externalUploadAsSlackFile(client, imageBuffer, filename, userId);
        if (extFirst.ok) {
          if (!isProduction) console.log(`External upload (unshared) created Slack file: ${extFirst.file.id}`);
          return {
            fileId: extFirst.file.id,
            localUrl: await fileServer.saveTemporaryFile(imageBuffer, filename),
            slackFile: extFirst.file,
            origin: 'external'
          };
        }

        // Open an IM channel with the user to obtain a valid D* channel id
        let dmChannelId;
        try {
          const im = await client.conversations.open({ users: userId });
          dmChannelId = im.channel?.id;
          if (!dmChannelId) throw new Error('IM_OPEN_NO_CHANNEL');
        } catch (openErr) {
          logSlackError('conversations.open', openErr);
          throw openErr;
        }
        const dmUpload = await client.files.uploadV2({
          channel_id: dmChannelId,
          file: imageBuffer,
          filename: filename,
          title: `AI Edited Profile Photo - ${context}`,
          alt_txt: `AI edited profile photo using prompt: ${context}`
        });
        const uploaded = dmUpload?.files?.[0] || dmUpload?.file || null;
        if (!uploaded?.id) {
          throw new Error('UPLOAD_RETURNED_NO_FILE_ID');
        }
        if (!isProduction) console.log(`Uploaded image to user's DM: ${uploaded.id}`);
        return {
          fileId: uploaded.id,
          localUrl: await fileServer.saveTemporaryFile(imageBuffer, filename),
          slackFile: uploaded,
          origin: 'dm'
        };
    } catch (dmError) {
      console.error('DM upload failed, trying external upload');
      logSlackError('files.uploadV2(dm)', dmError);
      // Third attempt: External upload URL flow with Content-Length + compression retry
      const ext = await externalUploadAsSlackFile(client, imageBuffer, filename, userId);
      if (ext.ok) {
        if (!isProduction) console.log(`External upload completed as Slack file: ${ext.file.id}`);
        return {
          fileId: ext.file.id,
          localUrl: await fileServer.saveTemporaryFile(imageBuffer, filename),
          slackFile: ext.file,
          origin: 'external'
        };
      }
      console.error('External upload failed, using local fallback');
      const fileUrl = await fileServer.saveTemporaryFile(imageBuffer, filename);
      if (!isProduction) console.log(`Saved edited image locally: ${fileUrl}`);
      return { fileId: null, localUrl: fileUrl, slackFile: null, origin: 'fallback' };
    }
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
    const maxBytesGemini = Number(process.env.GEMINI_MAX_BYTES || 4 * 1024 * 1024);
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
      editPrompt = `Edit the first image using the style/elements from the second reference image: ${prompt}. Keep the edit natural and realistic. Apply the visual style, colors, or objects from the reference image to the first image.`;
    } else {
      editPrompt = `Edit this image: ${prompt}. Keep the edit natural and realistic.`;
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
    const contentParts = [originalImagePart];
    if (referenceImagePart) {
      contentParts.push(referenceImagePart);
    }
    contentParts.push(textPart);
    
    // Call Gemini with retries + fallbacks
    const response = await callGeminiWithRetry(ai, contentParts, isProduction);
    
    if (!isProduction) console.log('Received response from Gemini API');
    return await handleApiResponse(response, 'edit', client, userId, channelId);

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
        const maxBytesGemini = Number(process.env.GEMINI_MAX_BYTES || 4 * 1024 * 1024);
        const pre = await compressIfLarge(buffer, mimeType || 'image/jpeg', maxBytesGemini);
        contentParts.push(bufferToPart(pre.buffer, pre.mimeType || 'image/jpeg'));
      } catch (e) {
        console.error('Failed to download image for group edit:', e.message);
        throw new Error('Failed to download one of the images');
      }
    }

    contentParts.push({ text: `Edit these images: ${prompt}. Keep the edit natural and realistic.` });

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
