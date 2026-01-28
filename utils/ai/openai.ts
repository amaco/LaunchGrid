
import OpenAI from "openai";
import { AIStrategyProvider, ProjectContext, Blueprint, TaskContext, ContentDraft } from "./interface";

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

  async generateContent(task: TaskContext, apiKey?: string): Promise<ContentDraft> {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OpenAI API Key missing.");

    const openai = new OpenAI({ apiKey: key });

    // Check if this is a custom prompt (like filterTargets)
    const isCustomPrompt = !!task.customPrompt;

    const prompt = task.customPrompt || `
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
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: "You are a specialized content creator." },
          { role: "user", content: prompt }
        ],
        model: "gpt-4o",
        // Only use json_object for standard prompts - custom prompts may return arrays
        ...(isCustomPrompt ? {} : { response_format: { type: "json_object" } }),
      });

      const content = completion.choices[0].message.content;
      if (!content) throw new Error("No content returned");

      // For custom prompts, return raw content wrapped in a ContentDraft-like structure
      if (isCustomPrompt) {
        return {
          title: "Custom Response",
          content: content, // Raw AI response as string
          hashtags: [],
          suggestedImagePrompt: "",
        };
      }

      return JSON.parse(content);
    } catch (error) {
      console.error("OpenAI Content Error:", error);
      throw new Error("Failed to generate content.");
    }
  }
}
