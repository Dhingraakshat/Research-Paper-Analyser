import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

export async function analyzePDF(pdfBase64: string, fileName: string, systemInstruction: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: [
          {
            parts: [
              { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
              { text: `Please analyze the attached academic paper titled "${fileName}" and extract the data into the table format specified in the system instructions.` }
            ]
          }
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.1,
        },
      });

      return response.text || "No response from AI.";
    } catch (error: any) {
      lastError = error;
      if (error?.message?.includes('429') || error?.message?.includes('quota')) {
        const delay = Math.pow(2, attempt) * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Failed after multiple retries");
}

export async function analyzeAbstracts(abstracts: string, systemInstruction: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: [
          {
            text: `Please analyze the following list of papers and extract the data into the table format specified.\n\nData to Analyze:\n${abstracts}`
          }
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.1,
        },
      });

      return response.text || "No response from AI.";
    } catch (error: any) {
      lastError = error;
      // If it's a rate limit error (429), wait and retry
      if (error?.message?.includes('429') || error?.message?.includes('quota')) {
        const delay = Math.pow(2, attempt) * 2000; // 2s, 4s, 8s
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error("Failed after multiple retries");
}
