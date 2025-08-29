const { GoogleGenAI } = require('@google/genai');
const slackService = require('./slack');
const fileHost = require('./fileHost');

// Helper function to convert Buffer to the format Gemini expects
const bufferToPart = (buffer) => {
  const base64Data = buffer.toString('base64');
  const mimeType = 'image/jpeg'; // Assume JPEG for profile photos
  
  return {
    inlineData: {
      mimeType,
      data: base64Data
    }
  };
};

const handleApiResponse = async (response, context = 'edit', client, userId) => {
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
  
  // Check for prompt blocking first
  if (response.promptFeedback?.blockReason) {
    const { blockReason, blockReasonMessage } = response.promptFeedback;
    const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  // Try to find the image part
  const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

  if (imagePartFromResponse?.inlineData) {
    const { mimeType, data } = imagePartFromResponse.inlineData;
    console.log(`Received image data (${mimeType}) for ${context}`);
    
    // Convert base64 to buffer
    const imageBuffer = Buffer.from(data, 'base64');
    const filename = `edited_${Date.now()}.jpg`;
    
    // Upload to Slack for proper display
    try {
      const uploadResult = await client.files.upload({
        channels: userId, // Upload as DM to user
        file: imageBuffer,
        filename: filename,
        title: `AI Edited Profile Photo - ${context}`,
        filetype: 'jpg'
      });
      
      console.log(`Uploaded image to Slack: ${uploadResult.file.id}`);
      
      // Return both the file ID and local URL for fallback
      return {
        fileId: uploadResult.file.id,
        localUrl: fileHost.saveTemporaryFile(imageBuffer, filename),
        slackFile: uploadResult.file
      };
      
    } catch (uploadError) {
      console.error('Failed to upload to Slack, falling back to local file:', uploadError);
      
      // Fallback to local file
      const fileUrl = fileHost.saveTemporaryFile(imageBuffer, filename);
      console.log(`Saved edited image locally: ${fileUrl}`);
      return {
        fileId: null,
        localUrl: fileUrl,
        slackFile: null
      };
    }
  }

  // If no image, check for other reasons
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    console.error(`Image generation blocked. Reason: ${finishReason}`);
    
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
          : "This can happen due to safety filters or if the request is too complex. Please try rephrasing your prompt to be more direct.");

  console.error(`Model response did not contain an image part for ${context}.`);
  throw new Error(errorMessage);
};

async function editImage(imageUrl, prompt, client, userId) {
  try {
    console.log(`Starting image edit with prompt: "${prompt}"`);
    
    // Initialize Gemini AI
    const ai = new GoogleGenAI(process.env.API_KEY);
    
    // Debug: log available methods
    console.log('GoogleGenAI instance methods:', Object.getOwnPropertyNames(ai));
    console.log('GoogleGenAI prototype methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(ai)));
    
    // Download the original image
    const imageBuffer = await slackService.downloadImage(imageUrl);
    console.log(`Downloaded original image, size: ${imageBuffer.length} bytes`);
    
    // Convert to the format Gemini expects
    const originalImagePart = bufferToPart(imageBuffer);
    
    // Create a simpler, less detailed prompt to avoid safety triggers
    const editPrompt = `Edit this image: ${prompt}. Keep the edit natural and realistic.`;

    const textPart = { text: editPrompt };

    console.log('Sending image and prompt to Gemini 2.5 Flash Image Preview...');
    
    // Call the Gemini API
    console.log('API call details:', {
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
      partsCount: 2,
      imageSize: imageBuffer.length
    });
    
    // Try the most common API patterns for @google/genai
    let response;
    try {
      // Pattern 1: Direct model access
      const model = ai.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview' });
      console.log('Using getGenerativeModel pattern');
      response = await model.generateContent([originalImagePart, textPart]);
    } catch (error1) {
      console.log('getGenerativeModel failed, trying direct generateContent:', error1.message);
      try {
        // Pattern 2: Direct generateContent
        response = await ai.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
          contents: [{ parts: [originalImagePart, textPart] }]
        });
      } catch (error2) {
        console.log('Direct generateContent failed, trying models property:', error2.message);
        // Pattern 3: Models property
        response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-image-preview',
          contents: [{ parts: [originalImagePart, textPart] }]
        });
      }
    }
    
    console.log('Received response from Gemini API');
    return await handleApiResponse(response, 'edit', client, userId);

  } catch (error) {
    console.error('=== ERROR in editImage ===');
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('=== END ERROR ===');
    
    // Re-throw known content blocking errors to show user proper message
    if (error.message === 'CONTENT_BLOCKED' || error.message === 'GENERATION_FAILED') {
      throw error;
    }
    
    // For other API errors, show generic failure
    console.warn('Falling back to original image due to API error');
    throw new Error('Failed to process your image. Please try again.');
  }
}

// Alternative implementation using a mock/placeholder service for development
async function editImageMock(imageUrl, prompt) {
  try {
    console.log(`Mock editing image with prompt: "${prompt}"`);
    
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
      const fileUrl = fileHost.saveTemporaryFile(imageBuffer, filename);
      
      console.log(`Created mock edited image: ${fileUrl}`);
      return fileUrl;
      
    } catch (downloadError) {
      console.error('Error downloading placeholder, using original:', downloadError);
      return imageUrl;
    }

  } catch (error) {
    console.error('Error in mock image editing:', error);
    return imageUrl;
  }
}

// Export the real function - we want to test the actual Gemini API
const editImageFunction = editImage;

module.exports = {
  editImage: editImageFunction,
  editImageMock,
  editImageReal: editImage
};