export interface Intent {
  version?: string;
  command_id?: string;
  raw_text: string;
  action: string;
  target_object: string | null;
  target_location: string | null;
  parameters: Record<string, any>;
  confidence: number;
}

export interface AffordanceScore {
  skill_name: string;
  usefulness: number;
  feasibility: number;
  combined_score: number;
  breakdown?: {
    reachability?: number;
    collision_free?: number;
    object_state?: number;
    fusion?: string;
  };
}

export type SkillStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface PlanStep {
  id: string;
  skill: string;
  params: Record<string, any>;
  status: SkillStatus;
  detail?: string;
  loopGroup?: string;
  targetObject?: string;
}

export interface RosLog {
  id: string;
  timestamp: string;
  level: number; // 10=DEBUG, 20=INFO, 30=WARN, 40=ERROR, 50=FATAL
  levelName: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  nodeName: string;
  message: string;
  file?: string;
  line?: number;
}

export interface JointState {
  names: string[];
  positions: number[];
  velocities?: number[];
  efforts?: number[];
  timestamp?: number;
}

export type OrchestratorFsmState =
  | 'IDLE'
  | 'PARSING'
  | 'SCORING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'RECOVERING'
  | 'DONE'
  | 'FAILED';

export interface SeedCommandExample {
  instruction: string;
  intent: Intent;
}

export interface ObjectStateEvent {
  name: 'red_cube' | 'blue_cylinder' | 'green_sphere' | 'water';
  state: 'table' | 'held' | 'tray' | 'user';
}
