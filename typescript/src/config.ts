import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface MemoClawConfig {
  wallet?: string;
  privateKey?: string;
  url?: string;
}

const DEFAULT_CONFIG_PATH = join(homedir(), '.memoclaw', 'config.json');

/**
 * Load config from ~/.memoclaw/config.json (created by `memoclaw init`).
 * Returns empty config if file doesn't exist or is malformed.
 */
export function loadConfig(path?: string): MemoClawConfig {
  const configPath = path ?? DEFAULT_CONFIG_PATH;
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(raw);
    return {
      wallet: data.wallet ?? undefined,
      privateKey: data.privateKey ?? data.private_key ?? undefined,
      url: data.url ?? data.baseUrl ?? data.base_url ?? undefined,
    };
  } catch {
    return {};
  }
}
