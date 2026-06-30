import { GoogleGenerativeAI, type GenerationConfig } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// `thinkingConfig` is accepted by the Gemini 2.5 REST API but is not yet part of
// the legacy SDK's `GenerationConfig` type, so we declare the field we use.
type GenerationConfigWithThinking = GenerationConfig & {
  thinkingConfig?: { thinkingBudget?: number };
};

// Disabling the "thinking" phase (budget 0) cuts multi-second latency that these
// endpoints don't need — they do simple extraction / generation, not reasoning.
const FLASH_CONFIG: GenerationConfigWithThinking = {
  thinkingConfig: { thinkingBudget: 0 },
};

/**
 * Gemini 2.5 Flash with "thinking" disabled, for fast latency-sensitive routes.
 */
export function getFlashModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: FLASH_CONFIG,
  });
}
