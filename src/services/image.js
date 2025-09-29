const { GoogleGenAI } = require('@google/genai');
const slackService = require('./slack');
const fileServer = require('./fileServer');
const { logSlackError } = require('../utils/logging');

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
    
    // Upload to Slack for proper display
    try {
      if (!isProduction) console.log(`Attempting Slack upload to channel: ${channelId || userId}`);
      const uploadResult = await client.files.uploadV2({
        channel_id: channelId || userId, // Use channelId if provided, fallback to userId
        file: imageBuffer,
        filename: filename,
        title: `AI Edited Profile Photo - ${context}`,
        alt_txt: `AI edited profile photo using prompt: ${context}`
      });
      
      if (!isProduction) console.log(`Uploaded image to Slack: ${uploadResult.file.id}`);
      
      // Return both the file ID and local URL for fallback
      return {
        fileId: uploadResult.file.id,
        localUrl: await fileServer.saveTemporaryFile(imageBuffer, filename),
        slackFile: uploadResult.file
      };
      
    } catch (uploadError) {
      console.error('Slack upload failed to target channel, trying DM upload');
      // Log a sanitized error payload even in production
      logSlackError('files.uploadV2(channel)', uploadError);

      // Second attempt: upload to user's DM for native download support
      try {
        // Open an IM channel with the user to obtain a valid D* channel id
        const im = await client.conversations.open({ users: userId });
        const dmChannelId = im.channel?.id;
        const dmUpload = await client.files.uploadV2({
          channel_id: dmChannelId,
          file: imageBuffer,
          filename: filename,
          title: `AI Edited Profile Photo - ${context}`,
          alt_txt: `AI edited profile photo using prompt: ${context}`
        });
        if (!isProduction) console.log(`Uploaded image to user's DM: ${dmUpload.file.id}`);
        return {
          fileId: dmUpload.file.id,
          localUrl: await fileServer.saveTemporaryFile(imageBuffer, filename),
          slackFile: dmUpload.file
        };
      } catch (dmError) {
        console.error('DM upload failed, using local fallback');
        logSlackError('files.uploadV2(dm)', dmError);
        // Fallback to local file
        const fileUrl = await fileServer.saveTemporaryFile(imageBuffer, filename);
        if (!isProduction) console.log(`Saved edited image locally: ${fileUrl}`);
        return {
          fileId: null,
          localUrl: fileUrl,
          slackFile: null
        };
      }
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
    const imageBuffer = original.buffer;
    const originalMime = original.mimeType || 'image/jpeg';
    if (!isProduction) console.log(`Downloaded original image, size: ${imageBuffer.length} bytes, type: ${originalMime}`);
    
    // Convert to the format Gemini expects
    const originalImagePart = bufferToPart(imageBuffer, originalMime);
    
    // Download and convert reference image if provided
    let referenceImagePart = null;
    if (referenceImageUrl) {
      try {
        const ref = await slackService.downloadImageWithMime(referenceImageUrl);
        const referenceBuffer = ref.buffer;
        const referenceMime = ref.mimeType || 'image/jpeg';
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
    
    // Try the most common API patterns for @google/genai
    let response;
    try {
      // Pattern 1: Direct model access
      const model = ai.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview' });
      if (!isProduction) console.log('Using getGenerativeModel pattern');
      response = await model.generateContent(contentParts);
    } catch (error1) {
      if (!isProduction) console.log('getGenerativeModel failed, trying direct generateContent:', error1.message);
      try {
        // Pattern 2: Direct generateContent
        response = await ai.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
          contents: [{ parts: contentParts }]
        });
      } catch (error2) {
        if (!isProduction) console.log('Direct generateContent failed, trying models property:', error2.message);
        // Pattern 3: Models property
        response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
          contents: [{ parts: contentParts }]
        });
      }
    }
    
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

    // Prepare content parts from all images
    const contentParts = [];
    for (const url of imageUrls) {
      try {
        const { buffer, mimeType } = await slackService.downloadImageWithMime(url);
        contentParts.push(bufferToPart(buffer, mimeType || 'image/jpeg'));
      } catch (e) {
        console.error('Failed to download image for group edit:', e.message);
        throw new Error('Failed to download one of the images');
      }
    }

    contentParts.push({ text: `Edit these images: ${prompt}. Keep the edit natural and realistic.` });

    // Call Gemini with one request expecting a single image response
    let response;
    try {
      const model = ai.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview' });
      if (!isProduction) console.log('Using getGenerativeModel for group edit');
      response = await model.generateContent(contentParts);
    } catch (error1) {
      if (!isProduction) console.log('Group: getGenerativeModel failed, trying direct generateContent:', error1.message);
      try {
        response = await ai.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
          contents: [{ parts: contentParts }]
        });
      } catch (error2) {
        if (!isProduction) console.log('Group: Direct generateContent failed, trying models property:', error2.message);
        response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
          contents: [{ parts: contentParts }]
        });
      }
    }

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
