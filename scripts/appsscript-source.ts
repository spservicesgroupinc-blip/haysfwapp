/**
 * Loads the Apps Script backend as a single string.
 *
 * The backend ships as ONE file (Code.gs), so it can be pasted into the Apps
 * Script editor in a single go. The loader still concatenates every .gs file in
 * the folder, so the tests keep working if the layout ever changes. (It was
 * briefly split into six files to work around paste truncation in the editor.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const APPS_SCRIPT_DIR = join(process.cwd(), 'src', 'apps-script');

/** Every .gs file in the backend folder, ordered as Apps Script presents them. */
export function appsScriptFiles(): string[] {
  return readdirSync(APPS_SCRIPT_DIR)
    .filter((name) => name.endsWith('.gs'))
    .sort();
}

/** The concatenated source of every .gs file. */
export function loadAppsScriptSource(): string {
  const files = appsScriptFiles();
  if (files.length === 0) {
    throw new Error(`No .gs files found in ${APPS_SCRIPT_DIR}`);
  }
  return files.map((name) => readFileSync(join(APPS_SCRIPT_DIR, name), 'utf8')).join('\n');
}
