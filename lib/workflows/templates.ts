/**
 * Workflow Templates Registry
 * 
 * Following the constitution:
 * - Workflows are declarative, not hardcoded
 * - Config-driven templates for easy extensibility
 * - Templates define the shape, users customize the instance
 */

import type { StepType } from '@/lib/core/types';

export interface WorkflowTemplateStep {
    type: StepType;
    config?: Record<string, unknown>;
}

export interface WorkflowTemplate {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: 'engagement' | 'content' | 'growth' | 'custom';
    platform: 'twitter' | 'discord' | 'email' | 'all';
    steps: WorkflowTemplateStep[];
    estimatedTime?: string; // e.g., "5-10 min"
}

/**
 * Pre-built workflow templates
 * Users select a template, it creates a workflow with these steps
 */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
    // ===== ENGAGEMENT TEMPLATES =====
    {
        id: 'twitter-engagement',
        name: 'Engagement Flow',
        description: 'Scan feed, find high-value posts, and engage with thoughtful replies',
        icon: '🎯',
        category: 'engagement',
        platform: 'twitter',
        estimatedTime: '10-15 min',
        steps: [
            { type: 'SCAN_FEED', config: { platform: 'twitter' } },
            { type: 'SELECT_TARGETS', config: { maxTargets: 5 } },
            { type: 'GENERATE_REPLIES', config: {} },
            { type: 'REVIEW_CONTENT', config: {} },
            { type: 'POST_REPLY', config: {} },
            { type: 'TRACK_ENGAGEMENT', config: {} },
        ],
    },

    // ===== CONTENT CREATION TEMPLATES =====
    {
        id: 'twitter-thread',
        name: 'Thread Creator',
        description: 'Create an engaging multi-tweet thread with AI assistance',
        icon: '🧵',
        category: 'content',
        platform: 'twitter',
        estimatedTime: '15-20 min',
        steps: [
            { type: 'GENERATE_OUTLINE', config: { format: 'thread' } },
            { type: 'GENERATE_DRAFT', config: { format: 'thread' } },
            { type: 'REVIEW_CONTENT', config: {} },
            { type: 'POST_EXTENSION', config: { type: 'thread' } },
            { type: 'TRACK_ENGAGEMENT', config: {} },
        ],
    },
    {
        id: 'twitter-quick-post',
        name: 'Quick Post',
        description: 'Generate a single engaging tweet with viral hooks',
        icon: '⚡',
        category: 'content',
        platform: 'twitter',
        estimatedTime: '5-10 min',
        steps: [
            { type: 'GENERATE_HOOKS', config: { count: 3 } },
            { type: 'GENERATE_DRAFT', config: { format: 'single' } },
            { type: 'REVIEW_CONTENT', config: {} },
            { type: 'POST_EXTENSION', config: { type: 'post' } },
            { type: 'TRACK_ENGAGEMENT', config: {} },
        ],
    },

    // ===== GROWTH TEMPLATES =====
    {
        id: 'twitter-growth-daily',
        name: 'Daily Growth Routine',
        description: 'Complete daily routine: engage with 5 posts + create 1 original post',
        icon: '📈',
        category: 'growth',
        platform: 'twitter',
        estimatedTime: '20-30 min',
        steps: [
            { type: 'SCAN_FEED', config: { platform: 'twitter' } },
            { type: 'SELECT_TARGETS', config: { maxTargets: 5 } },
            { type: 'GENERATE_REPLIES', config: {} },
            { type: 'REVIEW_CONTENT', config: {} },
            { type: 'POST_REPLY', config: {} },
            { type: 'GENERATE_HOOKS', config: { count: 3 } },
            { type: 'GENERATE_DRAFT', config: { format: 'single' } },
            { type: 'REVIEW_CONTENT', config: {} },
            { type: 'POST_EXTENSION', config: {} },
            { type: 'TRACK_ENGAGEMENT', config: {} },
        ],
    },

    // ===== BLANK TEMPLATE =====
    {
        id: 'blank',
        name: 'Blank Workflow',
        description: 'Start from scratch and build your own workflow',
        icon: '📄',
        category: 'custom',
        platform: 'all',
        steps: [],
    },
];

/**
 * Get templates filtered by platform
 */
export function getTemplatesByPlatform(platform: string): WorkflowTemplate[] {
    return WORKFLOW_TEMPLATES.filter(
        (t) => t.platform === platform || t.platform === 'all'
    );
}

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): WorkflowTemplate | undefined {
    return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get templates grouped by category
 */
export function getTemplatesGroupedByCategory(): Record<string, WorkflowTemplate[]> {
    return WORKFLOW_TEMPLATES.reduce((acc, template) => {
        if (!acc[template.category]) {
            acc[template.category] = [];
        }
        acc[template.category].push(template);
        return acc;
    }, {} as Record<string, WorkflowTemplate[]>);
}

/**
 * Category display names
 */
export const CATEGORY_LABELS: Record<string, string> = {
    engagement: '🎯 Engagement',
    content: '📝 Content Creation',
    growth: '📈 Growth',
    custom: '🔧 Custom',
};
