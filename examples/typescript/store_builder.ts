/**
 * Using StoreBuilder for fluent memory creation.
 */
import { MemoClawClient } from '@memoclaw/sdk';

const client = new MemoClawClient({ wallet: '0xYourWalletAddress' });

// Method 1: Direct client call
const result1 = await client.store({
  content: 'User prefers dark mode',
  importance: 0.8,
  metadata: { tags: ['preferences', 'ui'] },
  namespace: 'user-prefs',
});

// Method 2: Using StoreBuilder — chain options fluently
const result2 = await client
  .storeBuilder()
  .content('User prefers Vim keybindings')
  .importance(0.9)
  .addTag('preferences')
  .addTag('editor')
  .namespace('user-prefs')
  .pinned(true)
  .execute();

console.log(`Direct store: ${result1.id}`);
console.log(`Builder store: ${result2.id}`);
