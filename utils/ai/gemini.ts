
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AIStrategyProvider, ProjectContext, Blueprint, TaskContext, ContentDraft } from "./interface";

export class GeminiProvider implements AIStrategyProvider {
  async generateBlueprint(context: ProjectContext, apiKey?: string): Promise<Blueprint> {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("Gemini API Key missing. Please set it in Settings.");
    }

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("Gemini Generation Error:", error);
      throw new Error("Gemini Generation Failed");
    }
  }

  async generateContent(task: TaskContext, apiKey?: string): Promise<ContentDraft> {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) throw new Error("Gemini API Key missing.");

    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const prompt = `
        You are a specialised Content Creator for the "${task.pillarName}" channel.
        Project: ${task.project.name}
        Context: ${task.project.description}
        Audience: ${task.project.audience}

        **Your Task:**
        Execute the content strategy: "${task.workflowName}".
        Strategy Description: "${task.workflowDescription}".

        Write a high-quality, engagement-focused piece of content. 
        If it's for Twitter, keep it concise or make it a thread. 
        If it's for SEO, provide an outline.
        If it's for Discord, be conversational.

        Return ONLY a JSON object:
        {
            "title": "Internal Title / Subject Line",
            "content": "The actual post body (markdown supported)",
            "hashtags": ["#tag1", "#tag2"],
            "suggestedImagePrompt": "Description of an image that would go well with this post"
        }
        `;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (error) {
      console.error("Gemini Content Error:", error);
      throw new Error("Failed to generate content.");
    }
  }
}
