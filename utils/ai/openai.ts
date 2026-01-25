
import OpenAI from "openai";
import { AIStrategyProvider, ProjectContext, Blueprint } from "./interface";

export class OpenAIProvider implements AIStrategyProvider {
    async generateBlueprint(context: ProjectContext, apiKey?: string): Promise<Blueprint> {

        // Fallback to env var if generic key logic used, but strongly prefer user key
        const key = apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error("OpenAI API Key missing. Please set it in Settings.");
        }

        const openai = new OpenAI({ apiKey: key });

        const prompt = `
      You are an expert Chief Marketing Officer (CMO) for SaaS products.
      I need you to generate a "LaunchGrid Marketing Blueprint" for the following product:
      
      Name: ${context.name}
      Description: ${context.description}
      Target Audience: ${context.audience}
      Pain Points: ${context.painPoints}
      Monthly Budget: $${context.budget}

      The Blueprint must be a JSON object strictly following this structure:
      {
        "active_pillars": [
          { "id": "pillar_id", "type": "social_organic | community | paid_ads | email | content_seo | custom", "name": "Human Readable Name" }
        ],
        "workflows": [
          {
            "workflow_id": "unique_id",
            "pillar_ref": "pillar_id_from_above",
            "name": "Strategy Name (e.g. The Truth Teller)",
            "goal": "awareness | conversion | retention",
            "frequency": "daily | weekly | monthly",
            "description": "Brief explanation of this strategy."
          }
        ]
      }

      **Guidelines:**
      1. Select 2-4 pillars that maximize ROI for the given budget.
      2. If budget < $500, focus on Organic (Twitter/LinkedIn) and Community (Discord).
      3. If budget > $2000, include Paid Ads.
      4. Create at least 1 workflow per pillar.
      5. Return ONLY the JSON object. No markdown, no conversation.
    `;

        try {
            const completion = await openai.chat.completions.create({
                messages: [{ role: "system", content: "You are a marketing strategy generator." }, { role: "user", content: prompt }],
                model: "gpt-4o", // Default to optimized model
                response_format: { type: "json_object" },
            });

            const content = completion.choices[0].message.content;
            if (!content) throw new Error("No content returned");

            return JSON.parse(content);
        } catch (error) {
            console.error("OpenAI Generation Error:", error);
            throw new Error("Failed to generate blueprint with OpenAI.");
        }
    }
}
