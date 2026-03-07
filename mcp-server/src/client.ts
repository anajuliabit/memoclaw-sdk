/**
 * Factory for creating a MemoClawClient from environment/config.
 */
import type { MemoClawClientInterface } from './types.js';

/**
 * Create a MemoClawClient from environment variables or config file.
 *
 * Dynamically imports @memoclaw/sdk at runtime. Install it as a peer dependency:
 *   npm install @memoclaw/sdk
 *
 * Looks for:
 *   - MEMOCLAW_PRIVATE_KEY (for signed auth, full access)
 *   - MEMOCLAW_WALLET (for wallet-only, free endpoints)
 *   - ~/.memoclaw/config.json (created by `memoclaw init`)
 *   - MEMOCLAW_URL (custom API base URL)
 */
export async function createClient(): Promise<MemoClawClientInterface> {
  let mod: any;
  try {
    // Dynamic import — @memoclaw/sdk is a peer dependency
    mod = await (Function('return import("@memoclaw/sdk")')() as Promise<any>);
  } catch {
    throw new Error(
      'Could not import @memoclaw/sdk. Install it with: npm install @memoclaw/sdk',
    );
  }

  return new mod.MemoClawClient() as MemoClawClientInterface;
}
