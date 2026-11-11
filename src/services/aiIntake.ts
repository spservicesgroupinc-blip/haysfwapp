import { callAuthenticatedAppsScript, DatabaseError } from './appsScriptService';
import type { AiIntakePayload } from './intakeParser';

/** Apps Script calls OpenRouter free models with its server-side key; only document text is sent. */
export async function analyzeIntakeWithAi(rawText: string): Promise<AiIntakePayload> {
  if (!rawText.trim()) throw new Error('No intake text to analyze.');
  try {
    return await callAuthenticatedAppsScript<AiIntakePayload>('analyzeIntake', { rawText }, 120000);
  } catch (error) {
    if (error instanceof DatabaseError && error.code === 'unknown_action') {
      throw new Error('The Apps Script URL is serving a version without AI analysis. Replace the entire Code.gs, then select Deploy > Manage deployments > Edit > Version: New version > Deploy. Keep the existing deployment URL. Saving Code.gs alone does not update the live app.');
    }
    throw error;
  }
}
