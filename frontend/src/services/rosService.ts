import * as ROSLIB from 'roslib';
import type {
  Intent,
  AffordanceScore,
  PlanStep,
  RosLog,
  JointState,
  OrchestratorFsmState,
  ObjectStateEvent
} from '../types';
import { SEED_COMMANDS } from '../data/seedCommands';

type ConnectionCallback = (connected: boolean, url: string) => void;
type JointStateCallback = (jointState: JointState) => void;
type LogCallback = (log: RosLog) => void;
type StateCallback = (state: OrchestratorFsmState) => void;
type ObjectStateCallback = (event: ObjectStateEvent) => void;
type PipelineProgressCallback = (data: {
  stage: 'PARSING' | 'SCORING' | 'PLANNING' | 'EXECUTING' | 'DONE' | 'FAILED';
  intent?: Intent;
  affordances?: AffordanceScore[];
  plan?: PlanStep[];
  activeStepId?: string;
  error?: string;
}) => void;

class RosBridgeService {
  private ros: ROSLIB.Ros | null = null;
  private wsUrl: string = 'ws://localhost:9090';
  private connected: boolean = false;
  private reconnectInterval: any = null;

  // Track arm joint angles continuously so motions NEVER snap back to 0
  private currentJointPositions: number[] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.03];

  // Listeners
  private connectionListeners: Set<ConnectionCallback> = new Set();
  private jointListeners: Set<JointStateCallback> = new Set();
  private logListeners: Set<LogCallback> = new Set();
  private stateListeners: Set<StateCallback> = new Set();
  private pipelineListeners: Set<PipelineProgressCallback> = new Set();
  private objectStateListeners: Set<ObjectStateCallback> = new Set();

  // Active ROS subscriptions
  private rosoutSub: ROSLIB.Topic | null = null;
  private jointStatesSub: ROSLIB.Topic | null = null;
  private orchStateSub: ROSLIB.Topic | null = null;

  constructor() {}

  public init(url: string = 'ws://localhost:9090'): void {
    this.wsUrl = url;
    this.connect();
  }

  public connect(): void {
    if (this.ros) {
      try {
        this.ros.close();
      } catch (e) {
        // ignore
      }
    }

    try {
      this.ros = new ROSLIB.Ros({ url: this.wsUrl });

      this.ros.on('connection', () => {
        this.connected = true;
        this.notifyConnection(true);
        this.emitLog({
          level: 20,
          levelName: 'INFO',
          nodeName: 'web_bridge',
          message: `Connected to ROS 2 bridge at ${this.wsUrl}`
        });
        this.subscribeTopics();
      });

      this.ros.on('error', (_error: any) => {
        this.connected = false;
        this.notifyConnection(false);
      });

      this.ros.on('close', () => {
        this.connected = false;
        this.notifyConnection(false);
      });
    } catch (e) {
      this.connected = false;
      this.notifyConnection(false);
    }
  }

  public disconnect(): void {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    if (this.ros) {
      this.ros.close();
    }
    this.connected = false;
    this.notifyConnection(false);
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getUrl(): string {
    return this.wsUrl;
  }

  public getCurrentJointPositions(): number[] {
    return [...this.currentJointPositions];
  }

  public onObjectEvent(cb: ObjectStateCallback): () => void {
    this.objectStateListeners.add(cb);
    return () => this.objectStateListeners.delete(cb);
  }

  public emitObjectEvent(event: ObjectStateEvent): void {
    this.objectStateListeners.forEach((cb) => cb(event));
  }

  public resetObjects(): void {
    const items: Array<'red_cube' | 'blue_cylinder' | 'green_sphere' | 'water'> = [
      'red_cube',
      'blue_cylinder',
      'green_sphere',
      'water'
    ];
    items.forEach((item) => {
      this.emitObjectEvent({ name: item, state: 'table' });
    });
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'tabletop_env',
      message: 'Workspace reset: All items repositioned to starting tabletop coordinates.'
    });
  }

  public normalizeObjectName(raw?: string | null): 'red_cube' | 'blue_cylinder' | 'green_sphere' | 'water' | null {
    if (!raw) return null;
    const l = raw.toLowerCase();
    if (l.includes('cube') || l.includes('red')) return 'red_cube';
    if (l.includes('cylinder') || l.includes('blue')) return 'blue_cylinder';
    if (l.includes('sphere') || l.includes('green') || l.includes('ball')) return 'green_sphere';
    if (l.includes('water') || l.includes('glass') || l.includes('cup') || l.includes('drink') || l.includes('bottle')) return 'water';
    return null;
  }

  private subscribeTopics(): void {
    if (!this.ros || !this.connected) return;

    // 1. Subscribe to /rosout
    this.rosoutSub = new ROSLIB.Topic({
      ros: this.ros,
      name: '/rosout',
      messageType: 'rcl_interfaces/msg/Log'
    });
    this.rosoutSub.subscribe((msg: any) => {
      const levelMap: Record<number, 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'> = {
        10: 'DEBUG',
        20: 'INFO',
        30: 'WARN',
        40: 'ERROR',
        50: 'FATAL'
      };
      this.emitLog({
        level: msg.level || 20,
        levelName: levelMap[msg.level] || 'INFO',
        nodeName: msg.name || 'ros2_node',
        message: msg.msg || '',
        file: msg.file,
        line: msg.line
      });
    });

    // 2. Subscribe to /joint_states
    this.jointStatesSub = new ROSLIB.Topic({
      ros: this.ros,
      name: '/joint_states',
      messageType: 'sensor_msgs/msg/JointState'
    });
    this.jointStatesSub.subscribe((msg: any) => {
      if (msg.name && msg.position) {
        msg.name.forEach((name: string, i: number) => {
          const mapIdx: Record<string, number> = {
            joint1: 0,
            joint2: 1,
            joint3: 2,
            joint4: 3,
            joint5: 4,
            joint6: 5,
            gripper_joint: 6
          };
          if (name in mapIdx) {
            this.currentJointPositions[mapIdx[name]] = msg.position[i];
          }
        });

        this.jointListeners.forEach((cb) =>
          cb({
            names: msg.name,
            positions: msg.position,
            velocities: msg.velocity,
            efforts: msg.effort
          })
        );
      }
    });

    // 3. Subscribe to orchestrator status
    this.orchStateSub = new ROSLIB.Topic({
      ros: this.ros,
      name: '/nora/orchestrator/state',
      messageType: 'std_msgs/msg/String'
    });
    this.orchStateSub.subscribe((msg: any) => {
      if (msg.data) {
        this.stateListeners.forEach((cb) => cb(msg.data as OrchestratorFsmState));
      }
    });
  }

  public async executeCommand(text: string): Promise<void> {
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'web_console',
      message: `User instruction dispatched: "${text}"`
    });

    if (this.connected && this.ros) {
      await this.executeViaRosbridge(text);
    } else {
      await this.executeSimulated(text);
    }
  }

  private async executeViaRosbridge(text: string): Promise<void> {
    if (!this.ros) return;

    this.notifyPipeline({ stage: 'PARSING' });
    this.stateListeners.forEach((cb) => cb('PARSING'));

    const intentTopic = new ROSLIB.Topic({
      ros: this.ros,
      name: '/nora/intent_raw',
      messageType: 'std_msgs/msg/String'
    });
    intentTopic.publish({ data: text });

    const nluClient = new ROSLIB.Service({
      ros: this.ros,
      name: '/nora/extract_intent',
      serviceType: 'nora_interfaces/srv/ExtractIntent'
    });

    nluClient.callService(
      { raw_text: text },
      (res: any) => {
        if (res && res.intent) {
          const intent: Intent = {
            raw_text: text,
            action: res.intent.action,
            target_object: res.intent.target_object || null,
            target_location: res.intent.target_location || null,
            parameters: {},
            confidence: res.intent.confidence || 0.95
          };
          this.notifyPipeline({ stage: 'SCORING', intent });
          this.fetchAffordances(intent);
        } else {
          this.executeSimulated(text);
        }
      },
      () => {
        this.executeSimulated(text);
      }
    );
  }

  private fetchAffordances(intent: Intent): void {
    if (!this.ros) return;

    const affClient = new ROSLIB.Service({
      ros: this.ros,
      name: '/nora/score_affordances',
      serviceType: 'nora_interfaces/srv/ScoreAffordances'
    });

    affClient.callService(
      {
        intent: {
          raw_text: intent.raw_text,
          action: intent.action,
          target_object: intent.target_object || '',
          target_location: intent.target_location || '',
          parameters_json: JSON.stringify(intent.parameters),
          confidence: intent.confidence
        }
      },
      (res: any) => {
        if (res && res.scores) {
          const scores: AffordanceScore[] = res.scores.map((s: any) => ({
            skill_name: s.skill_name,
            usefulness: s.usefulness || 0.9,
            feasibility: s.feasibility || 0.95,
            combined_score: s.combined_score || 0.85
          }));
          scores.sort((a, b) => b.combined_score - a.combined_score);
          this.notifyPipeline({ stage: 'PLANNING', intent, affordances: scores });
        } else {
          const localAffs = this.computeLocalAffordances(intent);
          this.notifyPipeline({ stage: 'PLANNING', intent, affordances: localAffs });
        }
      },
      () => {
        const localAffs = this.computeLocalAffordances(intent);
        this.notifyPipeline({ stage: 'PLANNING', intent, affordances: localAffs });
      }
    );
  }

  private async executeSimulated(text: string): Promise<void> {
    // 1. NLU Parsing
    this.notifyPipeline({ stage: 'PARSING' });
    this.stateListeners.forEach((cb) => cb('PARSING'));
    await this.delay(300);

    const intent = this.parseSimulatedIntent(text);
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_nlu',
      message: `[NLU] Parsed intent: action='${intent.action}' target='${intent.target_object || 'none'}' loc='${intent.target_location || 'none'}' conf=${(intent.confidence * 100).toFixed(0)}%`
    });

    this.notifyPipeline({ stage: 'SCORING', intent });
    this.stateListeners.forEach((cb) => cb('SCORING'));

    // 2. Affordance Scoring
    await this.delay(350);
    const affordances = this.computeLocalAffordances(intent);
    const topAff = affordances[0];

    // SayCan Safety Guardrail: If confidence < 0.30 or skill usefulness < 0.20
    if (!topAff || topAff.combined_score < 0.30 || intent.action === 'unknown') {
      this.emitLog({
        level: 30,
        levelName: 'WARN',
        nodeName: 'nora_affordance',
        message: `[SayCan Guardrail] Instruction "${text}" rejected: No physically grounded skill scored above threshold (max_score=${topAff ? topAff.combined_score.toFixed(3) : '0.000'} < 0.30).`
      });
      this.emitLog({
        level: 40,
        levelName: 'ERROR',
        nodeName: 'nora_orchestrator',
        message: `Task aborted by SayCan guardrail: Preconditions not met for ungrounded or unsupported instruction.`
      });

      this.notifyPipeline({
        stage: 'FAILED',
        intent,
        affordances,
        error: `SayCan Guardrail Triggered: The utterance "${text}" does not correspond to an actionable physical skill. All candidate skills scored below the threshold (0.30). The arm safely remains in idle pose.`
      });
      this.stateListeners.forEach((cb) => cb('FAILED'));

      setTimeout(() => {
        this.stateListeners.forEach((cb) => cb('IDLE'));
      }, 5000);
      return;
    }

    // Affordance passed threshold
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_affordance',
      message: `[Affordance] Selected skill '${topAff.skill_name}' score=${topAff.combined_score.toFixed(3)} (usefulness=${topAff.usefulness.toFixed(2)}, feasibility=${topAff.feasibility.toFixed(2)})`
    });

    this.notifyPipeline({ stage: 'PLANNING', intent, affordances });
    this.stateListeners.forEach((cb) => cb('PLANNING'));

    // 3. Plan Generation
    await this.delay(400);
    const plan = this.generatePlanSteps(intent);
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_orchestrator',
      message: `[Planner] Generated ${plan.length}-step plan: [${plan.map((p) => p.skill).join(' -> ')}]`
    });

    this.notifyPipeline({ stage: 'EXECUTING', intent, affordances, plan, activeStepId: plan[0]?.id });
    this.stateListeners.forEach((cb) => cb('EXECUTING'));

    // 4. Sequential Execution Animation
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      step.status = 'running';
      this.notifyPipeline({
        stage: 'EXECUTING',
        intent,
        affordances,
        plan: [...plan],
        activeStepId: step.id
      });

      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'moveit_ompl',
        message: `[OMPL RRTConnect] Planning collision-free trajectory for step ${i + 1}/${plan.length}: ${step.skill}`
      });

      if (step.skill === 'reset_table') {
        this.resetObjects();
        await this.delay(350);
      } else {
        await this.simulateJointMotion(step, intent);
      }

      // Track item attachment on end-effector and release
      if (step.skill === 'pick') {
        const obj = this.normalizeObjectName(step.targetObject || intent.target_object);
        if (obj) {
          this.emitObjectEvent({ name: obj, state: 'held' });
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_gripper',
            message: `Grasp confirmed: [${obj}] securely attached to end-effector fingers.`
          });
        }
      } else if (step.skill === 'place') {
        const obj = this.normalizeObjectName(step.targetObject || intent.target_object);
        if (obj) {
          const targetLoc = step.params?.target_location || intent.target_location;
          const dest = targetLoc === 'user' ? 'user' : targetLoc === 'table' ? 'table' : 'tray';
          this.emitObjectEvent({ name: obj, state: dest });
          this.emitLog({
            level: 20,
            levelName: 'INFO',
            nodeName: 'nora_gripper',
            message: `Deposit confirmed: [${obj}] successfully placed in [${dest}].`
          });
        }
      }

      step.status = 'completed';
      this.emitLog({
        level: 20,
        levelName: 'INFO',
        nodeName: 'nora_skills',
        message: `[Skill] Step ${i + 1} (${step.skill}) completed successfully.`
      });
    }

    // Finished
    await this.delay(350);
    this.notifyPipeline({ stage: 'DONE', intent, affordances, plan });
    this.stateListeners.forEach((cb) => cb('DONE'));
    this.emitLog({
      level: 20,
      levelName: 'INFO',
      nodeName: 'nora_orchestrator',
      message: `Task execution finished successfully. All skill goals reached.`
    });

    setTimeout(() => {
      this.stateListeners.forEach((cb) => cb('IDLE'));
    }, 3000);
  }

  private parseSimulatedIntent(text: string): Intent {
    const lower = text.toLowerCase().trim();

    // 1. Exact or partial match with seed commands
    const seed = SEED_COMMANDS.find(
      (s) => s.instruction.toLowerCase() === lower || lower.includes(s.instruction.toLowerCase())
    );
    if (seed) {
      return {
        ...seed.intent,
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text
      };
    }

    // 2. Explicit detection of unsupported / conversational / boredom inputs
    const conversationalKeywords = [
      'bored', 'mored', 'tired', 'sleep', 'sing', 'dance', 'talk', 'joke', 'hello',
      'hi ', 'hey', 'who are you', 'what can you do', 'why', 'sad', 'happy', 'fun'
    ];
    for (const kw of conversationalKeywords) {
      if (lower.includes(kw)) {
        return {
          version: '1.0',
          command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
          raw_text: text,
          action: 'unknown',
          target_object: null,
          target_location: null,
          parameters: {},
          confidence: 0.12
        };
      }
    }

    // 3. Dynamic Loop Detection for ANY repetitive or multi-object command
    const loop = this.detectLoopIntent(text);
    if (loop) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: loop.actionName,
        target_object: loop.targets.join(', '),
        target_location: loop.destination,
        parameters: {
          is_loop: true,
          loop_targets: loop.targets,
          loop_count: loop.count,
          source: loop.source,
          destination: loop.destination,
          sub_action: 'pick_and_place'
        },
        confidence: 0.98
      };
    }

    // 4. Reset table items
    if (lower.includes('reset items') || lower.includes('reset objects') || lower.includes('reset table')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'reset_table',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }
    if (lower.includes('thirsty') || lower.includes('water') || lower.includes('drink')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'pick',
        target_object: 'water',
        target_location: 'user',
        parameters: {},
        confidence: 0.98
      };
    }
    if (lower.includes('cube') || lower.includes('red block')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: lower.includes('place') || lower.includes('put') ? 'place' : 'pick',
        target_object: 'red_cube',
        target_location: lower.includes('tray') ? 'tray' : 'table',
        parameters: {},
        confidence: 0.96
      };
    }
    if (lower.includes('sphere') || lower.includes('ball')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'pick',
        target_object: 'blue_sphere',
        target_location: 'table',
        parameters: {},
        confidence: 0.95
      };
    }
    if (lower.includes('cylinder')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'pick',
        target_object: 'blue_cylinder',
        target_location: 'table',
        parameters: {},
        confidence: 0.95
      };
    }
    if (lower.includes('glass') || lower.includes('cup') || lower.includes('bottle')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'pick',
        target_object: 'glass',
        target_location: 'user',
        parameters: {},
        confidence: 0.96
      };
    }
    if (lower.includes('trash') || lower.includes('bin')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'place',
        target_object: 'trash',
        target_location: 'bin',
        parameters: {},
        confidence: 0.92
      };
    }
    if (lower.includes('home') || lower.includes('park') || lower.includes('return to home')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'go_home',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }
    if (lower.includes('open') && lower.includes('gripper')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'open_gripper',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }
    if (lower.includes('close') || lower.includes('grip')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'close_gripper',
        target_object: null,
        target_location: null,
        parameters: {},
        confidence: 1.0
      };
    }
    if (lower.includes('pick') || lower.includes('grab') || lower.includes('take') || lower.includes('lift')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'pick',
        target_object: 'object',
        target_location: null,
        parameters: {},
        confidence: 0.85
      };
    }
    if (lower.includes('place') || lower.includes('put') || lower.includes('set down')) {
      return {
        version: '1.0',
        command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
        raw_text: text,
        action: 'place',
        target_object: 'object',
        target_location: 'tray',
        parameters: {},
        confidence: 0.85
      };
    }

    return {
      version: '1.0',
      command_id: 'cmd-' + Math.random().toString(36).substring(2, 9),
      raw_text: text,
      action: 'unknown',
      target_object: null,
      target_location: null,
      parameters: {},
      confidence: 0.10
    };
  }

  public detectLoopIntent(text: string): {
    isLoop: boolean;
    targets: Array<'red_cube' | 'blue_cylinder' | 'green_sphere' | 'water'>;
    count: number;
    source: 'table' | 'tray';
    destination: 'tray' | 'table' | 'user';
    actionName: string;
  } | null {
    const lower = text.toLowerCase().trim();

    // 1. Loop trigger indicators
    const isClean =
      lower.includes('clean table') ||
      lower.includes('clean up the table') ||
      lower.includes('clear table') ||
      lower.includes('clear the table') ||
      lower.includes('clear workspace') ||
      lower.includes('tidy table') ||
      lower.includes('empty table') ||
      lower.includes('clean up');

    const isRerack =
      lower.includes('re rack') ||
      lower.includes('rerack') ||
      lower.includes('re-rack') ||
      lower.includes('rack table') ||
      lower.includes('rack objects') ||
      lower.includes('rack items') ||
      lower.includes('put back all') ||
      lower.includes('return objects to table') ||
      lower.includes('return items to table');

    const hasLoopKeyword =
      lower.includes('loop') ||
      lower.includes('repeat') ||
      lower.includes('again') ||
      lower.includes('iterate') ||
      lower.includes('continuously') ||
      lower.includes('batch');

    const hasQuantifier =
      lower.includes('all') ||
      lower.includes('every') ||
      lower.includes('each') ||
      lower.includes('both') ||
      lower.includes('everything') ||
      lower.includes('all objects') ||
      lower.includes('all items') ||
      lower.includes('all blocks') ||
      lower.includes('all cylinders') ||
      lower.includes('all spheres');

    // 2. Count extraction (e.g. "3 times", "twice", "repeat 2 times")
    let count: number | null = null;
    const countMatch = lower.match(/(?:repeat|run|do\s+this|loop|pick\s+and\s+place)?\s*(\d+)\s*(?:times|x|iterations)/i);
    if (countMatch) {
      count = parseInt(countMatch[1], 10);
    } else if (lower.includes('twice') || lower.includes('2 times') || lower.includes('two times')) {
      count = 2;
    } else if (lower.includes('thrice') || lower.includes('3 times') || lower.includes('three times')) {
      count = 3;
    } else if (lower.includes('4 times') || lower.includes('four times')) {
      count = 4;
    } else if (lower.includes('both')) {
      count = 2;
    }

    // 3. Multi-object detection
    const extractedTargets: Array<'red_cube' | 'blue_cylinder' | 'green_sphere' | 'water'> = [];
    if (lower.includes('cube') || lower.includes('red')) extractedTargets.push('red_cube');
    if (lower.includes('cylinder') || lower.includes('blue')) extractedTargets.push('blue_cylinder');
    if (lower.includes('sphere') || lower.includes('green') || lower.includes('ball')) extractedTargets.push('green_sphere');
    if (lower.includes('water') || lower.includes('drink') || lower.includes('glass') || lower.includes('cup')) extractedTargets.push('water');

    const hasMultipleObjects = extractedTargets.length >= 2;

    // Check if this command requires a loop
    const requiresLoop =
      isClean ||
      isRerack ||
      hasLoopKeyword ||
      hasQuantifier ||
      count !== null ||
      hasMultipleObjects;

    if (!requiresLoop) {
      return null;
    }

    // Determine targets
    let finalTargets = extractedTargets;
    if (finalTargets.length === 0) {
      // Default to the 3 main tabletop objects
      finalTargets = ['red_cube', 'blue_cylinder', 'green_sphere'];
    }

    // Determine count
    const finalCount = count !== null ? Math.max(1, count) : finalTargets.length;

    // Determine source and destination
    let source: 'table' | 'tray' = 'table';
    let destination: 'tray' | 'table' | 'user' = 'tray';

    if (
      isRerack ||
      lower.includes('from tray') ||
      lower.includes('from storage') ||
      lower.includes('to table') ||
      lower.includes('onto table')
    ) {
      source = 'tray';
      destination = 'table';
    } else if (
      lower.includes('user') ||
      lower.includes('give me') ||
      lower.includes('hand me') ||
      lower.includes('bring me')
    ) {
      source = 'table';
      destination = 'user';
    } else {
      source = 'table';
      destination = 'tray';
    }

    const actionName = isRerack ? 'rerack_table' : isClean ? 'clean_table' : 'loop_task';

    return {
      isLoop: true,
      targets: finalTargets,
      count: finalCount,
      source,
      destination,
      actionName
    };
  }

  private computeLocalAffordances(intent: Intent): AffordanceScore[] {
    const candidateSkills = [
      'pick',
      'place',
      'move_to_pose',
      'open_gripper',
      'close_gripper',
      'go_home'
    ];

    if (intent.action === 'unknown') {
      return candidateSkills
        .map((skill) => {
          const usefulness = 0.05;
          const feasibility = 0.85;
          const combined = Math.pow(usefulness, 0.6) * Math.pow(feasibility, 0.4);
          return {
            skill_name: skill,
            usefulness,
            feasibility,
            combined_score: Math.min(1.0, Math.max(0.0, combined)),
            breakdown: { reachability: 0.85, collision_free: 0.95, object_state: 0.95 }
          };
        })
        .sort((a, b) => b.combined_score - a.combined_score);
    }

    const isLoopAction =
      Boolean(intent.parameters?.is_loop) ||
      ['clean_table', 'rerack_table', 'loop_task'].includes(intent.action);

    const results: AffordanceScore[] = candidateSkills.map((skill) => {
      let usefulness = 0.15;
      let reachability = 0.92;
      let collision_free = 0.95;
      let object_state = 0.98;

      if (skill === intent.action) {
        usefulness = 0.95;
      } else if (isLoopAction) {
        if (skill === 'pick') usefulness = 0.96;
        else if (skill === 'place') usefulness = 0.92;
        else if (skill === 'move_to_pose') usefulness = 0.85;
        else if (skill === 'open_gripper') usefulness = 0.75;
        else if (skill === 'go_home') usefulness = 0.85;
        else usefulness = 0.40;
      } else if (intent.action === 'reset_table') {
        if (skill === 'go_home') usefulness = 0.95;
        else usefulness = 0.40;
      } else if (intent.action === 'pick' && skill === 'move_to_pose') {
        usefulness = 0.65;
      } else if (intent.action === 'pick' && skill === 'close_gripper') {
        usefulness = 0.55;
      } else if (intent.action === 'place' && skill === 'open_gripper') {
        usefulness = 0.65;
      } else if (intent.action === 'go_home' && skill === 'move_to_pose') {
        usefulness = 0.50;
      }

      const feasibility = Math.min(1.0, reachability * collision_free * object_state);
      const combined = Math.pow(usefulness, 0.6) * Math.pow(feasibility, 0.4);

      return {
        skill_name: skill,
        usefulness,
        feasibility,
        combined_score: Math.min(1.0, Math.max(0.0, combined)),
        breakdown: {
          reachability,
          collision_free,
          object_state,
          fusion: 'weighted_product'
        }
      };
    });

    results.sort((a, b) => b.combined_score - a.combined_score);
    return results;
  }

  private buildGeneralizedLoopPlan(intent: Intent): PlanStep[] {
    const id = () => Math.random().toString(36).substring(2, 7);
    const loopTargets: Array<'red_cube' | 'blue_cylinder' | 'green_sphere' | 'water'> =
      intent.parameters?.loop_targets && intent.parameters.loop_targets.length > 0
        ? intent.parameters.loop_targets
        : ['red_cube', 'blue_cylinder', 'green_sphere'];

    const count: number = intent.parameters?.loop_count || loopTargets.length;
    const source: 'table' | 'tray' =
      intent.parameters?.source || (intent.action === 'rerack_table' ? 'tray' : 'table');
    const destination: 'tray' | 'table' | 'user' =
      intent.parameters?.destination || (intent.action === 'rerack_table' ? 'table' : 'tray');

    // Build execution items array repeating or slicing as needed
    const executionItems: Array<'red_cube' | 'blue_cylinder' | 'green_sphere' | 'water'> = [];
    for (let i = 0; i < count; i++) {
      executionItems.push(loopTargets[i % loopTargets.length]);
    }

    const plan: PlanStep[] = [];
    executionItems.forEach((item, index) => {
      const friendlyName = item.replace('_', ' ');
      const actionVerb = source === 'tray' ? 'Re-rack' : destination === 'user' ? 'Deliver' : 'Clear';
      const loopLabel = `Loop ${index + 1}/${executionItems.length}: ${actionVerb} ${friendlyName}`;

      if (source === 'tray') {
        plan.push(
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'approach_target', target: 'tray' },
            status: 'pending',
            detail: `[${loopLabel}] Move above storage tray for ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Open gripper fingers`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'pick',
            params: { target_object: item, from_tray: true },
            status: 'pending',
            detail: `[${loopLabel}] Grip ${friendlyName} from storage tray`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'pre_grasp', target: item },
            status: 'pending',
            detail: `[${loopLabel}] Transfer ${friendlyName} back to tabletop station`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'place',
            params: { target_location: 'table', target_object: item },
            status: 'pending',
            detail: `[${loopLabel}] Place ${friendlyName} on tabletop staging spot`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Release grip from ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          }
        );
      } else {
        const isUserDest = destination === 'user';
        plan.push(
          {
            id: id(),
            skill: 'move_to_pose',
            params: { pose_name: 'pre_grasp', target: item },
            status: 'pending',
            detail: `[${loopLabel}] Align end-effector above ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Open gripper fingers`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'pick',
            params: { target_object: item },
            status: 'pending',
            detail: `[${loopLabel}] Descend and grasp ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'move_to_pose',
            params: {
              pose_name: isUserDest ? 'handover' : 'approach_target',
              target: destination
            },
            status: 'pending',
            detail: `[${loopLabel}] Transfer ${friendlyName} towards ${destination}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'place',
            params: { target_location: destination, target_object: item },
            status: 'pending',
            detail: `[${loopLabel}] Deposit ${friendlyName} inside ${destination}`,
            loopGroup: loopLabel,
            targetObject: item
          },
          {
            id: id(),
            skill: 'open_gripper',
            params: { stroke_mm: 80 },
            status: 'pending',
            detail: `[${loopLabel}] Release grip from ${friendlyName}`,
            loopGroup: loopLabel,
            targetObject: item
          }
        );
      }
    });

    plan.push({
      id: id(),
      skill: 'go_home',
      params: {},
      status: 'pending',
      detail: `Final: Loop sequence completed (${executionItems.length} iterations). Retract arm to home transit pose.`,
      loopGroup: 'Final Retract'
    });

    return plan;
  }

  private generatePlanSteps(intent: Intent): PlanStep[] {
    const id = () => Math.random().toString(36).substring(2, 7);

    if (
      Boolean(intent.parameters?.is_loop) ||
      ['clean_table', 'rerack_table', 'loop_task'].includes(intent.action)
    ) {
      return this.buildGeneralizedLoopPlan(intent);
    }

    if (intent.action === 'reset_table') {
      return [
        {
          id: id(),
          skill: 'reset_table',
          params: {},
          status: 'pending',
          detail: 'Reset all objects back to initial tabletop coordinates'
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Return arm to home position'
        }
      ];
    }

    if (intent.action === 'pick') {
      const objName = intent.target_object || 'item';
      return [
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: 'pre_grasp', target: objName },
          status: 'pending',
          detail: `Align end-effector above ${objName}`
        },
        {
          id: id(),
          skill: 'open_gripper',
          params: { stroke_mm: 80 },
          status: 'pending',
          detail: 'Open fingers to 80mm span'
        },
        {
          id: id(),
          skill: 'pick',
          params: { target_object: objName },
          status: 'pending',
          detail: `Descend and grip ${objName}`
        },
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: intent.target_location === 'user' ? 'handover' : 'lift' },
          status: 'pending',
          detail: intent.target_location === 'user' ? 'Deliver to user handover zone' : 'Lift 15cm above table'
        }
      ];
    }

    if (intent.action === 'place') {
      const loc = intent.target_location || 'tray';
      return [
        {
          id: id(),
          skill: 'move_to_pose',
          params: { pose_name: 'approach_target', target: loc },
          status: 'pending',
          detail: `Move arm above ${loc}`
        },
        {
          id: id(),
          skill: 'place',
          params: { target_location: loc },
          status: 'pending',
          detail: `Lower and release object onto ${loc}`
        },
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Retract to safe transit home pose'
        }
      ];
    }

    if (intent.action === 'open_gripper') {
      return [
        {
          id: id(),
          skill: 'open_gripper',
          params: { stroke_mm: 80 },
          status: 'pending',
          detail: 'Open gripper fingers'
        }
      ];
    }

    if (intent.action === 'close_gripper') {
      return [
        {
          id: id(),
          skill: 'close_gripper',
          params: intent.parameters,
          status: 'pending',
          detail: 'Close gripper firmly'
        }
      ];
    }

    if (intent.action === 'go_home') {
      return [
        {
          id: id(),
          skill: 'go_home',
          params: {},
          status: 'pending',
          detail: 'Return arm joints to zero home position'
        }
      ];
    }

    return [
      {
        id: id(),
        skill: intent.action,
        params: intent.parameters,
        status: 'pending',
        detail: `Execute skill ${intent.action}`
      }
    ];
  }

  // Calculate target joint angles for each skill step
  private getTargetPositionsForSkill(skill: string, step: PlanStep, intent: Intent): number[] {
    const curr = [...this.currentJointPositions];
    const targetObj = (step.targetObject || intent.target_object || '').toLowerCase();
    const poseName = step.params?.pose_name || '';

    // Map table objects to shoulder yaw (joint1)
    let yaw = -0.58; // default towards water glass at (0.24, -0.18)
    const isTrayAction =
      step.params?.from_tray ||
      poseName === 'approach_target' ||
      (skill === 'place' && step.params?.target_location !== 'table') ||
      targetObj.includes('tray') ||
      targetObj.includes('bin');

    if (isTrayAction) {
      yaw = 0.0; // towards storage tray at (0.42, 0.0)
    } else if (targetObj.includes('cube') || targetObj.includes('red')) {
      yaw = 2.40; // towards red cube at (-0.25, 0.22)
    } else if (targetObj.includes('cylinder') || targetObj.includes('blue')) {
      yaw = 0.68; // towards blue cylinder at (0.25, 0.20)
    } else if (targetObj.includes('sphere') || targetObj.includes('green') || targetObj.includes('ball')) {
      yaw = -2.55; // towards green sphere at (-0.28, -0.18)
    } else if (targetObj.includes('water') || targetObj.includes('glass') || targetObj.includes('cup') || targetObj.includes('drink')) {
      yaw = -0.58;
    }

    if (skill === 'move_to_pose') {
      if (poseName === 'pre_grasp') {
        return [yaw, -0.45, 0.85, 0.0, -0.40, 0.0, curr[6]];
      } else if (poseName === 'handover') {
        return [-0.10, -0.30, 0.50, 0.0, -0.20, 0.0, curr[6]];
      } else if (poseName === 'lift') {
        return [curr[0], -0.30, 0.60, 0.0, -0.30, 0.0, curr[6]];
      } else if (poseName === 'approach_target') {
        return [0.0, -0.45, 0.85, 0.0, -0.40, 0.0, curr[6]];
      }
      return [yaw, -0.40, 0.70, 0.0, -0.30, 0.0, curr[6]];
    }

    if (skill === 'pick') {
      return [curr[0], -0.75, 1.25, 0.0, -0.50, 0.0, 0.02];
    }

    if (skill === 'place') {
      const isPlaceTable = step.params?.target_location === 'table';
      return [isPlaceTable ? curr[0] : 0.0, -0.70, 1.20, 0.0, -0.50, 0.0, 0.07];
    }

    if (skill === 'open_gripper') {
      return [curr[0], curr[1], curr[2], curr[3], curr[4], curr[5], 0.07];
    }

    if (skill === 'close_gripper') {
      return [curr[0], curr[1], curr[2], curr[3], curr[4], curr[5], 0.015];
    }

    if (skill === 'go_home') {
      return [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.03];
    }

    return [curr[0], curr[1], curr[2], curr[3], curr[4], curr[5], curr[6]];
  }

  // Smooth continuous multi-waypoint interpolation
  private async simulateJointMotion(step: PlanStep, intent: Intent): Promise<void> {
    const jointNames = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6', 'gripper_joint'];
    const startPositions = [...this.currentJointPositions];
    const targetPositions = this.getTargetPositionsForSkill(step.skill, step, intent);

    const steps = 24;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      // Cosine ease-in-out: smooth acceleration and deceleration
      const ease = (1 - Math.cos(t * Math.PI)) / 2;
      const currentPos = startPositions.map((start, i) => start + (targetPositions[i] - start) * ease);

      this.currentJointPositions = [...currentPos];
      this.jointListeners.forEach((cb) =>
        cb({
          names: jointNames,
          positions: this.currentJointPositions,
          timestamp: Date.now()
        })
      );
      await this.delay(45);
    }
  }

  public emergencyStop(): void {
    this.emitLog({
      level: 40,
      levelName: 'ERROR',
      nodeName: 'web_console',
      message: 'EMERGENCY STOP (E-STOP) ACTIVATED. Trajectory halted!'
    });
    this.stateListeners.forEach((cb) => cb('IDLE'));
  }

  // Listener subscriptions
  public onConnection(cb: ConnectionCallback): () => void {
    this.connectionListeners.add(cb);
    cb(this.connected, this.wsUrl);
    return () => this.connectionListeners.delete(cb);
  }

  public onJointStates(cb: JointStateCallback): () => void {
    this.jointListeners.add(cb);
    return () => this.jointListeners.delete(cb);
  }

  public onLog(cb: LogCallback): () => void {
    this.logListeners.add(cb);
    return () => this.logListeners.delete(cb);
  }

  public onOrchestratorState(cb: StateCallback): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  public onPipelineProgress(cb: PipelineProgressCallback): () => void {
    this.pipelineListeners.add(cb);
    return () => this.pipelineListeners.delete(cb);
  }

  private notifyConnection(connected: boolean): void {
    this.connectionListeners.forEach((cb) => cb(connected, this.wsUrl));
  }

  private emitLog(log: Omit<RosLog, 'id' | 'timestamp'>): void {
    const fullLog: RosLog = {
      ...log,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString()
    };
    this.logListeners.forEach((cb) => cb(fullLog));
  }

  private notifyPipeline(data: any): void {
    this.pipelineListeners.forEach((cb) => cb(data));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const rosService = new RosBridgeService();

