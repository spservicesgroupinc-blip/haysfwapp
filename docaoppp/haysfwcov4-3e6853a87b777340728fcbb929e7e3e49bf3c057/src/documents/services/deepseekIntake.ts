import { workspaceApi } from '../../services/workspaceApi';
import type { AiIntakePayload } from './intakeParser';

/** Apps Script calls DeepSeek using its private script property. */
export async function analyzeIntakeWithAi(rawText: string): Promise<AiIntakePayload> {
  if (!rawText.trim()) throw new Error('No intake text to analyze.');
  try {
    const result = await workspaceApi<{ analysis: AiIntakePayload }>('analyzeIntake', { rawText });
    if (!result?.analysis || typeof result.analysis !== 'object') {
      throw new Error('The database returned an invalid intake analysis.');
    }
    return result.analysis;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'unknown_action') {
      throw new Error('Deploy the latest Apps Script backend to enable AI intake analysis.');
    }
    throw error;
  }
}
