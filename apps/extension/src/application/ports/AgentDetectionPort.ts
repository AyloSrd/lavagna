import { AgentTargetId } from '../../domain/skills/types';

/** Which coding agents the user seems to have. A hint for pre-selection only. */
export interface AgentDetectionPort {
  detect(): Promise<AgentTargetId[]>;
}
