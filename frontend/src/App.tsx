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
  OrchestratorFsmState
} from './types';
import {
  Cpu,
  Terminal,
  Activity,
  Bot,
  Wifi,
  WifiOff,
  Settings
} from 'lucide-react';

export const App: React.FC = () => {
  // Navigation active tab
  const [activeTab, setActiveTab] = useState<'process' | 'logs' | 'status'>('process');

  // ROS Bridge states
  const [isConnected, setIsConnected] = useState(false);
  const [wsUrl, setWsUrl] = useState('ws://localhost:9090');
  const [showSettings, setShowSettings] = useState(false);
  const [customUrl, setCustomUrl] = useState('ws://localhost:9090');

  // Pipeline states
  const [fsmState, setFsmState] = useState<OrchestratorFsmState>('IDLE');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [affordances, setAffordances] = useState<AffordanceScore[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | undefined>();
  const [logs, setLogs] = useState<RosLog[]>([]);
  const [jointState, setJointState] = useState<JointState | null>(null);

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
    });

    return () => {
      unConnection();
      unState();
      unJoints();
      unLog();
      unPipeline();
    };
  }, []);

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
      <header className="nora-header">
        <div className="header-brand">
          <div className="brand-logo-wrap">
            <Bot size={22} className="brand-icon" />
          </div>
          <div>
            <div className="brand-name-row">
              <span className="brand-title">NORA</span>
              <span className="brand-tag">WEB CONSOLE</span>
            </div>
            <span className="brand-subtitle">Natural Language Orchestrated Robotics Agent</span>
          </div>
        </div>

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
            <h3>ROS 2 Bridge Configuration</h3>
            <p className="settings-help">
              Connect to <code>rosbridge_websocket</code> running on your ROS 2 host or container.
            </p>

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
                  Cancel
                </button>
                <button type="submit" className="btn-modal-save">
                  Connect
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Split Body */}
      <main className="nora-main-content">
        {/* Left Side: 3D Arm Digital Twin */}
        <section className="viewport-section">
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

      {/* Bottom Fixed Command Bar */}
      <footer className="nora-footer-command-bar">
        <CommandInput isBusy={isBusy} onCommandSubmit={handleCommandSubmit} />
      </footer>
    </div>
  );
};

export default App;
