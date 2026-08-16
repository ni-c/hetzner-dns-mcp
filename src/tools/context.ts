import type { HetznerApi } from '../api.js';
import type { ConfirmationStore } from '../confirm.js';

/** What every tool module needs beyond the MCP server itself. */
export interface ToolContext {
  api: HetznerApi;
  confirmations: ConfirmationStore;
  /** When true the write tools are not registered at all. */
  readOnly: boolean;
}
