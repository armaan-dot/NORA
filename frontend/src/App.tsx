import React, { useState, useEffect } from 'react';
import { ThreeCanvas } from './components/ThreeCanvas';
import { CommandInput } from './components/CommandInput';
import { ProcessTab } from './components/ProcessTab';
import { LogTerminal } from './components/LogTerminal';
import { ArmStatus } from './components/ArmStatus';
import { rosService } from './services/rosService';
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
  Bot,
  Wifi,
  WifiOff,
  Settings,
  Scale,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Info,
  AlertOctagon,
  Plus,
  X
} from 'lucide-react';

export const App: React.FC = () => {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState<'process' | 'logs' | 'status'>('process');

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
    isMissingApple?: boolean;
    isMissingObject?: boolean;
  } | null>(null);

  const topAffordance = affordances.length > 0 ? affordances[0] : null;

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
        const target = data.intent?.target_object || data.intent?.parameters?.target_name || '';
        const cmdLower = (data.intent?.raw_text || '').toLowerCase();
        const targetLower = target.toLowerCase();
        const isApple = targetLower.includes('apple') || cmdLower.includes('apple');
        const isMissing = data.guardrailEvent?.type === 'missing_object' || (data.error?.toLowerCase().includes('not present') ?? false) || (data.error?.toLowerCase().includes('not found') ?? false);

        setFailedTaskPopup({
          open: true,
          title: data.guardrailEvent?.title || 'Task Execution Interlocked (Affordance Failure)',
          reason: data.error || data.guardrailEvent?.reason || 'Affordance score fell below the required safety threshold (0.300). Preconditions not met.',
          score,
          threshold: 0.30,
          command: data.intent?.raw_text,
          skill: topAff?.skill_name || (data.intent?.action ?? 'unknown'),
          targetObject: target || (isApple ? 'Red Apple' : undefined),
          isMissingApple: isApple,
          isMissingObject: isMissing
        });
      } else if (data.stage === 'PARSING' || data.stage === 'EXECUTING') {
        setFailedTaskPopup(null);
      }
    });

    const unGuardrail = rosService.onGuardrail((evt) => {
      setGuardrailEvent(evt);
      if (evt && evt.active) {
        const cmdLower = (intent?.raw_text || '').toLowerCase();
        const reasonLower = (evt.reason || '').toLowerCase();
        const isApple = reasonLower.includes('apple') || cmdLower.includes('apple');
        setFailedTaskPopup({
          open: true,
          title: evt.title || 'SayCan Guardrail Triggered',
          reason: evt.reason,
          score: evt.score,
          threshold: evt.threshold,
          command: intent?.raw_text,
          skill: topAffordance?.skill_name || intent?.action || 'unknown',
          targetObject: intent?.target_object || (isApple ? 'Red Apple' : undefined),
          isMissingApple: isApple,
          isMissingObject: evt.type === 'missing_object'
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

  const handleSpawnApple = () => {
    rosService.addObject({
      name: 'Red Apple',
      shape: 'apple',
      color: '#e11d48',
      spawnZone: 'auto'
    });
    setFailedTaskPopup(null);
  };

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
      {/* Top Header Bar */}
      {/* Top Header Bar with Live Task Affordance Score Telemetry */}
      <header className="nora-header">
        <div className="header-brand">
          <div className="brand-logo-wrap">
            <Bot size={22} className="brand-icon" />
          </div>
          <div>
            <div className="brand-name-row">
              <span className="brand-title">NORA</span>
              <span className="brand-tag">WEB CONSOLE</span>
              <span className="brand-tag">ROBOTICS OS</span>
            </div>
            <span className="brand-subtitle">Natural Language Orchestrated Robotics Agent</span>
          </div>
        </div>

        {/* Center: Live Task Affordance Score Telemetry Widget (Minimalist & Crisp) */}
        <div
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

          <span className="affordance-pill-title">Affordance</span>

          {topAffordance ? (
            <div className="affordance-pill-values">
              <span className="affordance-score-num">
                {topAffordance.combined_score.toFixed(3)}
              </span>
              <span
                className={`affordance-badge ${
                  topAffordance.combined_score >= 0.70
                    ? 'badge-grounded'
                    : topAffordance.combined_score >= 0.30
                    ? 'badge-moderate'
                    : 'badge-rejected'
                }`}
              >
                {topAffordance.combined_score >= 0.70 ? (
                  <>
                    <ShieldCheck size={11} /> Grounded
                  </>
                ) : topAffordance.combined_score >= 0.30 ? (
                  <>
                    <Sparkles size={11} /> Feasible
                  </>
                ) : (
                  <>
                    <ShieldAlert size={11} /> Guardrail Block
                  </>
                )}
              </span>
              {topAffordance.skill_name && (
                <span className="affordance-pill-skill" title={`Target Skill: ${topAffordance.skill_name}`}>
                  {topAffordance.skill_name}
                </span>
              )}
            </div>
          ) : (
            <div className="affordance-pill-values">
              <span className="affordance-score-standby">Ready</span>
              <span className="affordance-badge badge-standby">τ ≥ 0.30</span>
            </div>
          )}

          <Info size={12} className="affordance-info-hint" />
        </div>

        {/* Affordance Formulation Popover */}
        {showAffordanceInfo && (
          <div
            className="affordance-info-popover"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="popover-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Scale size={15} className="icon-amber" />
                <h4>SayCan Affordance Formulation</h4>
              </div>
              <button
                className="btn-popover-close"
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
          {/* Connection Status Badge */}
          <div
            className={`connection-badge ${isConnected ? 'connected' : 'standalone'}`}
            onClick={() => setShowSettings(true)}
            title="Click to edit bridge connection URL"
          >
            {isConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            <span>{isConnected ? 'rosbridge: 9090' : 'Offline / Standalone'}</span>
          </div>

          <button
            className="btn-settings-icon"
            onClick={() => setShowSettings(!showSettings)}
            title="Connection Settings"
          >
            <Settings size={17} />
          </button>
        </div>
      </header>

      {/* Settings Modal Drawer */}
      {showSettings && (
        <div className="settings-modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="settings-modal-card" onClick={(e) => e.stopPropagation()}>
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
              <label>WebSocket Server URL:</label>
              <input
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
          <div className="failed-task-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="failed-modal-header">
              <div className="failed-header-left">
                <div className="failed-icon-box">
                  <ShieldAlert size={24} className="failed-pulse-icon" />
                </div>
                <div>
                  <div className="failed-tag-row">
                    <span className="failed-kicker">SAYCAN GUARDRAIL INTERLOCK</span>
                    <span className="failed-badge-pill">TASK REJECTED</span>
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
                    BELOW SAFETY THRESHOLD (τ &lt; 0.300)
                  </span>
                </div>

                <div className="failed-score-big-row">
                  <div className="failed-score-number">
                    {failedTaskPopup.score.toFixed(3)}
                  </div>
                  <div className="failed-score-status-box">
                    <span className="score-status-tag">STATUS: PRECONDITIONS FAILED</span>
                    <span className="score-status-sub">
                      Combined = (Usefulness)<sup>0.6</sup> × (Feasibility)<sup>0.4</sup>
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
                    {failedTaskPopup.targetObject || intent?.target_object || 'Missing Tabletop Object'}
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
                {failedTaskPopup.isMissingApple ? (
                  <button
                    type="button"
                    className="btn-failed-action-apple"
                    onClick={handleSpawnApple}
                    title="Instantly spawn a fresh Red Apple into the tabletop workspace"
                  >
                    <span className="action-emoji">🍎</span>
                    <span>Place Red Apple on Tabletop</span>
                  </button>
                ) : failedTaskPopup.isMissingObject ? (
                  <button
                    type="button"
                    className="btn-failed-action-spawn"
                    onClick={() => {
                      if (failedTaskPopup.targetObject) {
                        rosService.addObject({
                          name: failedTaskPopup.targetObject,
                          shape: 'box',
                          color: '#eab308',
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
      <main className="nora-main-content">
        {/* Left Side: 3D Arm Digital Twin */}
        <section className="viewport-section">
          {/* Top Command Search Bar: Positioned above 3D Arm Viewer */}
          <div className="viewport-top-command-area">
            <CommandInput isBusy={isBusy} onCommandSubmit={handleCommandSubmit} />
          </div>

          <div className="section-header-compact">
            <div className="section-title">
              <Cpu size={16} className="icon-cyan" />
              <span>Tabletop 3D Twin (nora_arm.urdf)</span>
            </div>
            <div className="arm-quick-status">
              <span className="pulse-dot" />
              <span>Kinematics Synced</span>
            </div>
          </div>

          <div className="viewport-render-box">
            <ThreeCanvas />
          </div>
        </section>

        {/* Right Side: Tabbed Inspection Workspace */}
        <section className="inspector-section">
          {/* Tabs Navigation Header */}
          <div className="inspector-tabs-nav">
            <button
              className={`tab-btn ${activeTab === 'process' ? 'active' : ''}`}
              onClick={() => setActiveTab('process')}
            >
              <Activity size={16} />
              <span>Process Tab</span>
              {isBusy && <span className="tab-busy-dot" />}
            </button>

            <button
              className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
              onClick={() => setActiveTab('logs')}
            >
              <Terminal size={16} />
              <span>ROS Logs</span>
              <span className="tab-counter">{logs.length}</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'status' ? 'active' : ''}`}
              onClick={() => setActiveTab('status')}
            >
              <Cpu size={16} />
              <span>Arm Status</span>
            </button>
          </div>

          {/* Active Tab Viewport */}
          <div className="inspector-tab-content">
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
          <span className="footer-label">NORA Orchestrator:</span>
          <span className={`footer-fsm-pill pill-${fsmState.toLowerCase()}`}>{fsmState}</span>
          <span className="footer-divider">•</span>
          <span className="footer-hint">Closed-form 6-DOF IK & SayCan Task Grounding Active</span>
        </div>
      </footer>
    </div>
  );
};

export default App;

