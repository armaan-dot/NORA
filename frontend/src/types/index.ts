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
  | 'SEARCHING'
  | 'PLANNING'
  | 'EXECUTING'
  | 'RECOVERING'
  | 'DONE'
  | 'FAILED';

export interface SeedCommandExample {
  instruction: string;
  intent: Intent;
}

export interface ObjectPosition {
  x: number;
  y: number;
  z: number;
}

export interface TabletopObject {
  id: string;
  name: string;
  shape: 'box' | 'cylinder' | 'sphere' | 'glass' | 'mug' | 'apple';
  color: string;
  position: ObjectPosition;
  state: 'table' | 'held' | 'tray' | 'user';
  isCustom?: boolean;
}

export interface ObjectStateEvent {
  name: string;
  state: 'table' | 'held' | 'tray' | 'user';
  position?: ObjectPosition;
}

export interface PerceptionScanEvent {
  active: boolean;
  targetObject?: string | null;
  detectedPosition?: ObjectPosition | null;
  confidence?: number;
}

export interface ArmSpeechEvent {
  message: string;
  subtext?: string;
  type: 'impossible' | 'warning' | 'info';
}

export interface GuardrailEvent {
  active: boolean;
  title: string;
  reason: string;
  score: number;
  threshold: number;
  type: 'impossible' | 'ungrounded' | 'missing_object' | 'reachability';
  timestamp?: number;
}


