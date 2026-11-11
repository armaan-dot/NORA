import React, { useState, useEffect } from 'react';
import { ThreeCanvas } from './components/ThreeCanvas';
import { CommandInput } from './components/CommandInput';
import { ProcessTab } from './components/ProcessTab';
import { LogTerminal } from './components/LogTerminal';
import { ArmStatus } from './components/ArmStatus';
import { SensorsPanel, TopicsPanel, PlotPanel } from './components/SimPanels';
import { useDialog } from './components/useDialog';
import {
  rosService,
  getEntityMetadata,
  containsExplicitWords,
  isPhysicalTask,
  type EntityMetadata
} from './services/rosService';
import type {
  Intent,
  AffordanceScore,
  PlanStep,
  RosLog,
  JointState,
  OrchestratorFsmState,
  GuardrailEvent
} from './types';
import {
  Cpu,
  Terminal,
  Activity,
  Wifi,
  WifiOff,
  Volume2,
  VolumeX,
  Scale,
  ShieldAlert,
  Info,
  AlertOctagon,
  Plus,
  X
} from 'lucide-react';

export const App: React.FC = () => {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState<'process' | 'logs' | 'status' | 'sensors' | 'topics' | 'plots'>('process');
  const [isAudioMuted, setIsAudioMuted] = useState(() => rosService.isAudioMuted());

  // ROS Bridge states
  const [isConnected, setIsConnected] = useState(false);
  const [wsUrl, setWsUrl] = useState('ws://localhost:9090');
  const [showSettings, setShowSettings] = useState(false);
  const [customUrl, setCustomUrl] = useState('ws://localhost:9090');
  const [showAffordanceInfo, setShowAffordanceInfo] = useState(false);

  // Pipeline states
  const [fsmState, setFsmState] = useState<OrchestratorFsmState>('IDLE');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [affordances, setAffordances] = useState<AffordanceScore[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | undefined>();
  const [logs, setLogs] = useState<RosLog[]>([]);
  const [jointState, setJointState] = useState<JointState | null>(null);
  const [pipelineError, setPipelineError] = useState<string | undefined>();
  const [guardrailEvent, setGuardrailEvent] = useState<GuardrailEvent | null>(null);

  // Red Failed Task Affordance Score Pop-up Modal State
  const [failedTaskPopup, setFailedTaskPopup] = useState<{
    open: boolean;
    title: string;
    reason: string;
    score: number;
    threshold: number;
    command?: string;
    skill?: string;
    targetObject?: string;
    isMissingObject?: boolean;
    isExplicit?: boolean;
    isPhysicalTask?: boolean;
    meta?: EntityMetadata;
  } | null>(null);

  const topAffordance = affordances.length > 0 ? affordances[0] : null;
  const settingsDialog = useDialog(showSettings, () => setShowSettings(false));
  const failureDialog = useDialog(Boolean(failedTaskPopup), () => setFailedTaskPopup(null));

  const isBusy =
    fsmState === 'PARSING' ||
    fsmState === 'SCORING' ||
    fsmState === 'PLANNING' ||
    fsmState === 'EXECUTING';

  useEffect(() => {
    // 1. Initialize ROS bridge service
    rosService.init(wsUrl);

    // 2. Register listeners
    const unConnection = rosService.onConnection((conn, url) => {
      setIsConnected(conn);
      setWsUrl(url);
    });

    const unState = rosService.onOrchestratorState((state) => {
      setFsmState(state);
    });

    const unJoints = rosService.onJointStates((js) => {
      setJointState(js);
    });

    const unLog = rosService.onLog((log) => {
      setLogs((prev) => [...prev.slice(-499), log]);
    });

    const unPipeline = rosService.onPipelineProgress((data) => {
      if (data.intent) setIntent(data.intent);
      if (data.affordances) setAffordances(data.affordances);
      if (data.plan) setPlan(data.plan);
      if (data.activeStepId) setActiveStepId(data.activeStepId);
      if (data.error !== undefined) setPipelineError(data.error);
      if (data.guardrailEvent !== undefined) setGuardrailEvent(data.guardrailEvent);

      if (data.stage === 'FAILED') {
        const topAff = data.affordances && data.affordances.length > 0 ? data.affordances[0] : null;
        const score = topAff ? topAff.combined_score : (data.guardrailEvent?.score ?? 0.0);
        const rawCmd = data.intent?.raw_text || '';
        const target = data.intent?.parameters?.target_name || data.intent?.target_object || data.guardrailEvent?.targetObject || '';
        const isExplicit =
          data.guardrailEvent?.type === 'explicit' ||
          data.intent?.action === 'explicit_blocked' ||
          containsExplicitWords(rawCmd) ||
          (data.error?.toLowerCase().includes('explicit') ?? false);

        const isPhysical =
          !isExplicit &&
          (isPhysicalTask(rawCmd) ||
            data.guardrailEvent?.type === 'impossible' ||
            data.intent?.action === 'impossible' ||
            data.intent?.action === 'guardrail_test');

        const meta = !isExplicit && !isPhysical ? getEntityMetadata(target || rawCmd) : undefined;

        const isMissing =
          !isExplicit &&
          !isPhysical &&
          (data.guardrailEvent?.type === 'missing_object' ||
            (data.error?.toLowerCase().includes('not present') ?? false) ||
            (data.error?.toLowerCase().includes('not found') ?? false) ||
            (data.error?.toLowerCase().includes('object grounding') ?? false) ||
            (data.error?.toLowerCase().includes('visual search failed') ?? false) ||
            Boolean(meta));

        setFailedTaskPopup({
          open: true,
          title: isExplicit
            ? 'Cannot process explicit words'
            : isPhysical
            ? (data.guardrailEvent?.title || 'Physical Task Interlock')
            : isMissing
            ? (data.guardrailEvent?.title || 'Object Grounding Guardrail')
            : (data.guardrailEvent?.title || 'Task Execution Interlocked (Affordance Failure)'),
          reason: isExplicit
            ? 'Safety Policy Interlock: Explicit words cannot be processed by the robot.'
            : isPhysical
            ? (data.guardrailEvent?.reason || data.error || `Task "${rawCmd}" is a physical action/task that cannot be executed. Servos remain locked at home pose.`)
            : (data.error || data.guardrailEvent?.reason || `Affordance score (${score.toFixed(3)}) fell below the required safety threshold (0.300). Preconditions not met.`),
          score: (isExplicit || isPhysical) ? 0.0 : score,
          threshold: 0.30,
          command: rawCmd,
          skill: isExplicit ? 'safety_interlock' : isPhysical ? 'physical_task_interlock' : (topAff?.skill_name || (data.intent?.action ?? 'deliver_to_user')),
          targetObject: isExplicit
            ? 'None (Safety Policy Violation)'
            : isPhysical
            ? 'None (Physical Task)'
            : meta?.name || target || 'None (Infeasible)',
          isMissingObject: isMissing,
          isExplicit,
          isPhysicalTask: isPhysical,
          meta
        });
      } else if (data.stage === 'PARSING' || data.stage === 'EXECUTING') {
        setFailedTaskPopup(null);
      }
    });

    const unGuardrail = rosService.onGuardrail((evt) => {
      setGuardrailEvent(evt);
      if (evt && evt.active) {
        const rawCmd = intent?.raw_text || '';
        const target = intent?.parameters?.target_name || intent?.target_object || evt.targetObject || '';
        const isExplicit =
          evt.type === 'explicit' ||
          intent?.action === 'explicit_blocked' ||
          containsExplicitWords(rawCmd) ||
          (evt.reason?.toLowerCase().includes('explicit') ?? false);

        const isPhysical =
          !isExplicit &&
          (isPhysicalTask(rawCmd) ||
            evt.type === 'impossible' ||
            intent?.action === 'impossible' ||
            intent?.action === 'guardrail_test');

        const meta = !isExplicit && !isPhysical ? getEntityMetadata(target || rawCmd) : undefined;

        const isMissing =
          !isExplicit &&
          !isPhysical &&
          (evt.type === 'missing_object' ||
            (evt.reason?.toLowerCase().includes('not present') ?? false) ||
            (evt.reason?.toLowerCase().includes('not found') ?? false) ||
            (evt.reason?.toLowerCase().includes('object grounding') ?? false) ||
            Boolean(meta));

        setFailedTaskPopup({
          open: true,
          title: isExplicit
            ? 'Cannot process explicit words'
            : isPhysical
            ? (evt.title || 'Physical Task Interlock')
            : isMissing
            ? (evt.title || 'Object Grounding Guardrail')
            : (evt.title || 'SayCan Guardrail Triggered'),
          reason: isExplicit
            ? 'Safety Policy Interlock: Explicit words cannot be processed by the robot.'
            : isPhysical
            ? (evt.reason || `Task "${rawCmd}" is a physical action/task that cannot be executed. Servos remain locked at home pose.`)
            : evt.reason,
          score: (isExplicit || isPhysical) ? 0.0 : evt.score,
          threshold: evt.threshold,
          command: rawCmd,
          skill: isExplicit ? 'safety_interlock' : isPhysical ? 'physical_task_interlock' : (topAffordance?.skill_name || intent?.action || 'deliver_to_user'),
          targetObject: isExplicit
            ? 'None (Safety Policy Violation)'
            : isPhysical
            ? 'None (Physical Task)'
            : meta?.name || target || 'None (Infeasible)',
          isMissingObject: isMissing,
          isExplicit,
          isPhysicalTask: isPhysical,
          meta
        });
      }
    });

    return () => {
      unConnection();
      unState();
      unJoints();
      unLog();
      unPipeline();
      unGuardrail();
    };
  }, [intent, topAffordance]);


  const handleCommandSubmit = async (cmdText: string) => {
    setActiveTab('process');
    await rosService.executeCommand(cmdText);
  };

  const handleConnectSettings = (e: React.FormEvent) => {
    e.preventDefault();
    rosService.init(customUrl);
    setShowSettings(false);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  const handleEmergencyStop = () => {
    rosService.emergencyStop();
  };

  const handleGoHome = () => {
    handleCommandSubmit('move to the home position');
  };

  return (
    <div className="nora-app-layout">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      {/* Top Header Bar */}
      {/* Top Header Bar with Live Task Affordance Score Telemetry */}
      <header className="nora-header">
        <div className="header-brand">
          <div>
            <div className="brand-name-row">
              <span className="brand-title">NORA</span>
              <span className="brand-context">Robotics workspace</span>
            </div>
          </div>
        </div>

        {/* Center: Live Task Affordance Score Telemetry Widget (One sentence, slightly bold) */}
        <button
          type="button"
          aria-expanded={showAffordanceInfo}
          aria-controls="affordance-details"
          className={`top-affordance-pill ${
            topAffordance
              ? topAffordance.combined_score >= 0.70
                ? 'status-high'
                : topAffordance.combined_score >= 0.30
                ? 'status-med'
                : 'status-low'
              : 'status-standby'
          }`}
          onClick={() => setShowAffordanceInfo(!showAffordanceInfo)}
          title="Click to view SayCan affordance breakdown & ROS 2 topics"
        >
          <div className="affordance-pill-icon">
            <Scale size={13} />
          </div>

          <span className="affordance-sentence">
            {topAffordance ? (
              <>
                Affordance score:{' '}
                <span className="affordance-sentence-val">
                  {topAffordance.combined_score.toFixed(3)}
                </span>{' '}
                <span className="affordance-sentence-status">
                  ({topAffordance.combined_score >= 0.70
                    ? 'Grounded'
                    : topAffordance.combined_score >= 0.30
                    ? 'Feasible'
                    : 'Guardrail Block'}
                  {topAffordance.skill_name ? ` • ${topAffordance.skill_name}` : ''})
                </span>
              </>
            ) : (
              <>
                Affordance score:{' '}
                <span className="affordance-sentence-val">Ready</span>{' '}
                <span className="affordance-sentence-status">(safety threshold τ ≥ 0.30)</span>
              </>
            )}
          </span>

          <Info size={12} className="affordance-info-hint" />
        </button>

        {/* Affordance Formulation Popover */}
        {showAffordanceInfo && (
          <div
            className="affordance-info-popover"
            id="affordance-details"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="popover-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Scale size={15} className="icon-amber" />
                <h4>SayCan Affordance Formulation</h4>
              </div>
              <button
                className="btn-popover-close"
                aria-label="Close affordance details"
                onClick={() => setShowAffordanceInfo(false)}
              >
                ×
              </button>
            </div>
            <div className="popover-body">
              {topAffordance && (
                <div className="popover-live-metrics">
                  <div className="popover-metric-box">
                    <span className="popover-metric-lbl">Combined Score</span>
                    <strong className="popover-metric-val">{topAffordance.combined_score.toFixed(3)}</strong>
                  </div>
                  <div className="popover-metric-box">
                    <span className="popover-metric-lbl">Usefulness</span>
                    <strong className="popover-metric-val">{topAffordance.usefulness.toFixed(2)}</strong>
                  </div>
                  <div className="popover-metric-box">
                    <span className="popover-metric-lbl">Feasibility</span>
                    <strong className="popover-metric-val">{topAffordance.feasibility.toFixed(2)}</strong>
                  </div>
                  <div className="popover-metric-box">
                    <span className="popover-metric-lbl">Skill</span>
                    <strong className="popover-metric-val">{topAffordance.skill_name}</strong>
                  </div>
                </div>
              )}

              <p>
                NORA grounds natural language instructions using the SayCan formulation,
                multiplying semantic task usefulness by robotic physical feasibility:
              </p>
              <div className="formula-box">
                <code>Score = (Usefulness)^0.6 × (Feasibility)^0.4</code>
              </div>
              <div className="popover-details">
                <div>
                  <strong>• Feasibility:</strong> Reachability (IK closed-form) × Collision-Free
                  (OMPL RRTConnect) × Gripper Stroke
                </div>
                <div>
                  <strong>• Safety Guardrail:</strong> Tasks with score &lt; 0.300 or action <code>unknown</code> are automatically rejected.
                </div>
                <div>
                  <strong>• Published ROS 2 Topics:</strong>
                  <br />
                  <code>/nora/task_affordance</code> (String JSON: task, skill, score, breakdown)
                  <br />
                  <code>/nora/affordance_score</code> (Float32: combined score)
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header Right Status & Config */}
        <div className="header-actions">
          <button
            type="button"
            className="audio-toggle"
            aria-label="Mute audio"
            aria-pressed={isAudioMuted}
            title={isAudioMuted ? 'Unmute robot audio' : 'Mute robot audio'}
            onClick={() => {
              const muted = !isAudioMuted;
              rosService.setAudioMuted(muted);
              setIsAudioMuted(muted);
            }}
          >
            {isAudioMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            <span>{isAudioMuted ? 'Muted' : 'Audio on'}</span>
          </button>
          {/* Connection Status Badge */}
          <button
            type="button"
            className={`connection-badge ${isConnected ? 'connected' : 'standalone'}`}
            onClick={() => setShowSettings(true)}
            title="Click to edit bridge connection URL"
          >
            {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{isConnected ? 'ROS bridge connected' : 'Simulation mode'}</span>
          </button>
        </div>
      </header>

      {/* Settings Modal Drawer */}
      {showSettings && (
        <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div ref={settingsDialog} role="dialog" aria-modal="true" aria-label="Connection settings" tabIndex={-1} className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>ROS 2 Bridge & Simulation Mode</h3>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 }}>
                {isConnected ? <Wifi size={16} className="icon-emerald" /> : <WifiOff size={16} className="icon-amber" />}
                <span>
                  <strong>Mode:</strong> {isConnected ? 'Live ROS 2 Bridge Connected' : 'Autonomous Standalone Simulation (Active)'}
                </span>
              </div>
              <p className="settings-help">
                {isConnected
                  ? 'Connected to live ROS 2 graph via rosbridge websocket.'
                  : 'NORA is currently operating in autonomous standalone simulation mode with full 6-DOF dynamic closed-form inverse kinematics and active vision search. Objects can be dragged anywhere on the table, and the arm dynamically searches and reaches them!'}
              </p>
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 14, marginBottom: 12 }}>
              <h4 style={{ fontSize: 13, marginBottom: 6, color: '#fff' }}>Connect to Live ROS 2 (Optional)</h4>
              <p className="settings-help">
                To stream real ROS 2 topics & actions from Ubuntu/WSL2/Docker:
                <br />
                <code>1. ros2 launch rosbridge_server rosbridge_websocket_launch.xml</code>
                <br />
                <code>2. ros2 launch nora_bringup nora_orchestrator.launch.py</code>
              </p>
            </div>

            <form onSubmit={handleConnectSettings}>
              <label htmlFor="bridge-url">WebSocket server URL</label>
              <input
                id="bridge-url"
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="ws://localhost:9090"
                className="settings-input"
              />

              <div className="modal-btn-row">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowSettings(false)}
                >
                  Close
                </button>
                <button type="submit" className="btn-modal-save">
                  {isConnected ? 'Reconnect' : 'Connect to Bridge'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Red Failed Task Affordance Score Pop-up Modal */}
      {failedTaskPopup && (
        <div className="failed-task-modal-backdrop" onClick={() => setFailedTaskPopup(null)}>
          <div ref={failureDialog} role="dialog" aria-modal="true" aria-label="Task rejected" tabIndex={-1} className="failed-task-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="failed-modal-header">
              <div className="failed-header-left">
                <div className="failed-icon-box">
                  <ShieldAlert size={24} className="failed-pulse-icon" />
                </div>
                <div>
                  <div className="failed-tag-row">
                    <span className="failed-kicker">
                      {failedTaskPopup.isExplicit
                        ? 'EXPLICIT CONTENT FILTER'
                        : failedTaskPopup.isPhysicalTask
                        ? 'PHYSICAL TASK INTERLOCK'
                        : 'SAYCAN GUARDRAIL INTERLOCK'}
                    </span>
                    <span className="failed-badge-pill">
                      {failedTaskPopup.isExplicit
                        ? 'CANNOT PROCESS'
                        : failedTaskPopup.isPhysicalTask
                        ? 'TASK INFEASIBLE'
                        : 'TASK REJECTED'}
                    </span>
                  </div>
                  <h3 className="failed-modal-title">{failedTaskPopup.title}</h3>
                </div>
              </div>
              <button
                className="btn-failed-modal-close"
                onClick={() => setFailedTaskPopup(null)}
                title="Dismiss Alert"
              >
                <X size={18} />
              </button>
            </div>

            <div className="failed-modal-body">
              {/* Prominent Red Affordance Score Banner */}
              <div className="failed-affordance-score-banner">
                <div className="failed-score-head">
                  <span className="failed-score-label">SAYCAN TASK AFFORDANCE SCORE</span>
                  <span className="failed-score-eval">
                    {failedTaskPopup.isExplicit
                      ? 'CANNOT PROCESS EXPLICIT WORDS'
                      : failedTaskPopup.isPhysicalTask
                      ? 'PHYSICAL TASK INFEASIBLE (τ = 0.000)'
                      : 'BELOW SAFETY THRESHOLD (τ < 0.300)'}
                  </span>
                </div>

                <div className="failed-score-big-row">
                  <div className="failed-score-number">
                    {failedTaskPopup.score.toFixed(3)}
                  </div>
                  <div className="failed-score-status-box">
                    <span className="score-status-tag">
                      {failedTaskPopup.isExplicit
                        ? 'STATUS: CANNOT PROCESS EXPLICIT WORDS'
                        : failedTaskPopup.isPhysicalTask
                        ? 'STATUS: PHYSICAL TASK CANNOT BE SPAWNED ON TABLE'
                        : 'STATUS: PRECONDITIONS FAILED'}
                    </span>
                    <span className="score-status-sub">
                      {failedTaskPopup.isExplicit
                        ? 'Zero affordance assigned due to safety & content moderation policy'
                        : failedTaskPopup.isPhysicalTask
                        ? 'Action is a physical task/motion, not a tabletop object that can be placed on table'
                        : <>Combined = (Usefulness)<sup>0.6</sup> × (Feasibility)<sup>0.4</sup></>}
                    </span>
                  </div>
                </div>

                {/* Red Affordance Meter Bar with Safety Threshold Marker */}
                <div className="failed-meter-bar-wrap">
                  <div className="failed-meter-track">
                    <div
                      className="failed-meter-fill-red"
                      style={{
                        width: `${Math.max(4, Math.min(100, failedTaskPopup.score * 100))}%`
                      }}
                    />
                    <div className="failed-threshold-marker" style={{ left: '30%' }}>
                      <span className="threshold-marker-tag">Limit τ=0.30</span>
                    </div>
                  </div>
                  <div className="failed-meter-scale">
                    <span>0.00 (Unfeasible)</span>
                    <span className="scale-tau text-amber">0.30 Safety Min</span>
                    <span>1.00 (Optimal)</span>
                  </div>
                </div>
              </div>

              {/* Guardrail Reason Callout */}
              <div className="failed-reason-box">
                <div className="reason-icon-col">
                  <AlertOctagon size={20} className="text-red" />
                </div>
                <div className="reason-text-col">
                  <strong>Interlock Explanation &amp; Physical Preconditions:</strong>
                  <p>{failedTaskPopup.reason}</p>
                </div>
              </div>

              {/* Context Breakdown Meta Grid */}
              <div className="failed-meta-grid">
                <div className="failed-meta-cell">
                  <span className="cell-label">Input Utterance</span>
                  <span className="cell-val highlight">"{failedTaskPopup.command || intent?.raw_text || 'none'}"</span>
                </div>
                <div className="failed-meta-cell">
                  <span className="cell-label">Target Entity</span>
                  <span className="cell-val text-red font-bold">
                    {failedTaskPopup.isExplicit
                      ? 'None (Safety Policy Violation)'
                      : failedTaskPopup.isPhysicalTask
                      ? 'None (Physical Task - No Tabletop Entity)'
                      : (failedTaskPopup.targetObject || intent?.target_object || 'Missing Tabletop Object')}
                  </span>
                </div>
                <div className="failed-meta-cell">
                  <span className="cell-label">Assessed Skill</span>
                  <span className="cell-val font-mono">
                    {failedTaskPopup.skill || 'deliver_to_user'}
                  </span>
                </div>
                <div className="failed-meta-cell">
                  <span className="cell-label">Manipulator Safety State</span>
                  <span className="cell-val text-cyan">Safe Idle Pose (0° Motion)</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="failed-modal-footer">
                {!failedTaskPopup.isExplicit && !failedTaskPopup.isPhysicalTask && failedTaskPopup.meta ? (
                  <button
                    type="button"
                    className="btn-failed-action-entity"
                    style={{
                      background: `linear-gradient(135deg, ${failedTaskPopup.meta.color}dd, ${failedTaskPopup.meta.color}99)`,
                      borderColor: failedTaskPopup.meta.color,
                      boxShadow: `0 0 20px ${failedTaskPopup.meta.color}44`
                    }}
                    onClick={() => {
                      if (failedTaskPopup.meta) {
                        rosService.addObject({
                          name: failedTaskPopup.meta.name,
                          shape: failedTaskPopup.meta.shape,
                          color: failedTaskPopup.meta.color,
                          spawnZone: 'auto'
                        });
                      }
                      setFailedTaskPopup(null);
                    }}
                    title={`Instantly spawn ${failedTaskPopup.meta.name} onto tabletop workspace`}
                  >
                    <span className="action-emoji">{failedTaskPopup.meta.emoji}</span>
                    <span>Place {failedTaskPopup.meta.name} on Tabletop</span>
                  </button>
                ) : !failedTaskPopup.isExplicit && !failedTaskPopup.isPhysicalTask && failedTaskPopup.isMissingObject ? (
                  <button
                    type="button"
                    className="btn-failed-action-spawn"
                    onClick={() => {
                      const meta = getEntityMetadata(failedTaskPopup.targetObject || '');
                      if (meta) {
                        rosService.addObject({
                          name: meta.name,
                          shape: meta.shape,
                          color: meta.color,
                          spawnZone: 'auto'
                        });
                      }
                      setFailedTaskPopup(null);
                    }}
                    title="Spawn requested object on table"
                  >
                    <Plus size={15} />
                    <span>Spawn "{failedTaskPopup.targetObject || 'Object'}"</span>
                  </button>
                ) : null}

                <button
                  type="button"
                  className="btn-failed-dismiss"
                  onClick={() => setFailedTaskPopup(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Split Body */}
      <div className="workspace-intro">
        <div>
          <p className="eyebrow">Natural Language Orchestrated Robotics Agent</p>
          <h1>From instruction to action.</h1>
          <p>Give the arm a task. Inspect the intent, evaluate its feasibility, and follow execution in the 3D workspace.</p>
        </div>
        <div className="workspace-mode">
          <span className="pulse-dot" />
          {isConnected ? 'Live ROS 2 connection' : 'Interactive simulation'}
        </div>
      </div>
      <main className="nora-main-content" id="workspace" tabIndex={-1}>
        {/* Left Side: 3D Arm Digital Twin */}
        <section className="viewport-section">
          {/* Top Command Search Bar: Positioned above 3D Arm Viewer */}
          <div className="viewport-top-command-area">
            <CommandInput isBusy={isBusy} onCommandSubmit={handleCommandSubmit} />
          </div>

          <div className="section-header-compact">
            <div className="section-title">
              <Cpu size={16} className="icon-cyan" />
              <span>3D workspace</span>
            </div>
            <div className="arm-quick-status">
              <span>6-DOF arm · Drag objects to reposition</span>
            </div>
          </div>

          <div className="viewport-render-box">
            <ThreeCanvas />
          </div>
        </section>

        {/* Right Side: Tabbed Inspection Workspace */}
        <section className="inspector-section">
          {/* Tabs Navigation Header */}
          <nav className="inspector-tabs-nav" aria-label="Workspace inspector">
            <button
              className={`tab-btn ${activeTab === 'process' ? 'active' : ''}`}
              onClick={() => setActiveTab('process')}
              aria-pressed={activeTab === 'process'}
              aria-controls="inspector-content"
            >
              <Activity size={16} />
              <span>Pipeline</span>
              {isBusy && <span className="tab-busy-dot" />}
            </button>

            <button
              className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
              aria-pressed={activeTab === 'logs'}
              aria-controls="inspector-content"
            >
              <Terminal size={16} />
              <span>Logs</span>
              <span className="tab-counter">{logs.length}</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'status' ? 'active' : ''}`}
              onClick={() => setActiveTab('status')}
              aria-pressed={activeTab === 'status'}
              aria-controls="inspector-content"
            >
              <Cpu size={16} />
              <span>Arm status</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'sensors' ? 'active' : ''}`}
              onClick={() => setActiveTab('sensors')}
              aria-pressed={activeTab === 'sensors'}
              aria-controls="inspector-content"
            >
              <Activity size={16} />
              <span>Sensors</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'topics' ? 'active' : ''}`}
              onClick={() => setActiveTab('topics')}
              aria-pressed={activeTab === 'topics'}
              aria-controls="inspector-content"
            >
              <Activity size={16} />
              <span>Topics</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'plots' ? 'active' : ''}`}
              onClick={() => setActiveTab('plots')}
              aria-pressed={activeTab === 'plots'}
              aria-controls="inspector-content"
            >
              <Activity size={16} />
              <span>Plots</span>
            </button>
          </nav>

          {/* Active Tab Viewport */}
          <div className="inspector-tab-content" id="inspector-content" role="region" aria-label={`${activeTab} inspector`}>
            {activeTab === 'process' && (
              <ProcessTab
                fsmState={fsmState}
                intent={intent}
                affordances={affordances}
                plan={plan}
                activeStepId={activeStepId}
                pipelineError={pipelineError}
                guardrailEvent={guardrailEvent}
              />
            )}

            {activeTab === 'logs' && (
              <LogTerminal logs={logs} onClearLogs={handleClearLogs} />
            )}

            {activeTab === 'sensors' && <SensorsPanel />}
            {activeTab === 'topics' && <TopicsPanel />}
            {activeTab === 'plots' && <PlotPanel />}

            {activeTab === 'status' && (
              <ArmStatus
                fsmState={fsmState}
                jointState={jointState}
                isConnected={isConnected}
                wsUrl={wsUrl}
                onEmergencyStop={handleEmergencyStop}
                onGoHome={handleGoHome}
              />
            )}
          </div>
        </section>
      </main>

      {/* Bottom Status Footer */}
      <footer className="nora-footer-status-bar">
        <div className="footer-status-inner">
          <span className="footer-label">Orchestrator</span>
          <span className={`footer-fsm-pill pill-${fsmState.toLowerCase()}`}>{fsmState}</span>
          <span className="footer-divider">•</span>
          <span className="footer-hint">6-DOF inverse kinematics · SayCan task grounding</span>
        </div>
      </footer>
    </div>
  );
};

export default App;

