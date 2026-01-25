
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openai";
import { AIStrategyProvider } from "./interface";

export type AIProviderID = 'gemini' | 'openai' | 'anthropic'; // Easy to extend

export class AIFactory {
    static getProvider(id: AIProviderID): AIStrategyProvider {
        switch (id) {
            case 'gemini':
                return new GeminiProvider();
            case 'openai':
                return new OpenAIProvider();
            default:
                throw new Error(`AI Provider ${id} not implemented.`);
        }
    }
}
