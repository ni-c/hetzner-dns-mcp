import type { HetznerApi } from '../api.js';
import type { Approver, ConfirmationStore } from 'mcp-approval';

/** What every tool module needs beyond the MCP server itself. */
export interface ToolContext {
  api: HetznerApi;
  confirmations: ConfirmationStore;
  /** Asks a person where the client can show a prompt; the store is the fallback. */
  approval: Approver;
  /** When true the write tools are not registered at all. */
  readOnly: boolean;
}
