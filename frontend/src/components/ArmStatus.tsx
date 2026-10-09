import React from 'react';
import type { JointState, OrchestratorFsmState } from '../types';
import {
  Activity,
  AlertOctagon,
  Home,
  CheckCircle2,
  Clock,
  Gauge,
  Wifi,
  WifiOff
} from 'lucide-react';

interface ArmStatusProps {
  fsmState: OrchestratorFsmState;
  jointState: JointState | null;
  isConnected: boolean;
  wsUrl: string;
  onEmergencyStop: () => void;
  onGoHome: () => void;
}

export const ArmStatus: React.FC<ArmStatusProps> = ({
  fsmState,
  jointState,
  isConnected,
  wsUrl,
  onEmergencyStop,
  onGoHome
}) => {
  const jointNames = [
    'joint1 (Base Yaw)',
    'joint2 (Shoulder Pitch)',
    'joint3 (Elbow Pitch)',
    'joint4 (Forearm Roll)',
    'joint5 (Wrist Pitch)',
    'joint6 (Wrist Roll)',
    'gripper_joint (Palm Stroke)'
  ];

  return (
    <div className="arm-status-container">
      {/* 1. Global Safety & Telemetry Card */}
      <div className="telemetry-grid">
        <div className="telemetry-card">
          <div className="telemetry-title">
            <Activity size={14} className="icon-cyan" />
            <span>FSM State</span>
          </div>
          <div className="telemetry-value">
            <span className={`status-pill pill-${fsmState.toLowerCase()}`}>
              {fsmState}
            </span>
          </div>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-title">
            <Gauge size={14} className="icon-emerald" />
            <span>Bridge Link</span>
          </div>
          <div className="telemetry-value">
            {isConnected ? (
              <span className="telemetry-connected">
                <Wifi size={14} /> Connected
              </span>
            ) : (
              <span className="telemetry-offline">
                <WifiOff size={14} /> Standalone
              </span>
            )}
          </div>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-title">
            <Clock size={14} className="icon-muted" />
            <span>Trajectory Status</span>
          </div>
          <div className="telemetry-value">
            {fsmState === 'EXECUTING' ? (
              <span className="badge-moving">Motion Active</span>
            ) : (
              <span className="badge-holding">Holding Pose</span>
            )}
          </div>
        </div>

        <div className="telemetry-card">
          <div className="telemetry-title">
            <CheckCircle2 size={14} className="icon-emerald" />
            <span>Controller Health</span>
          </div>
          <div className="telemetry-value">
            <span className="badge-ok">All Joints OK</span>
          </div>
        </div>
      </div>

      {/* 2. Arm Quick Controls Toolbar */}
      <div className="status-action-row">
        <button
          className="btn-status-action btn-home"
          onClick={onGoHome}
          title="Return arm to 0-joint home transit posture"
        >
          <Home size={15} />
          <span>Move to Home Position</span>
        </button>

        <button
          className="btn-status-action btn-estop"
          onClick={onEmergencyStop}
          title="Emergency Stop: Abort all trajectory goals instantly"
        >
          <AlertOctagon size={15} />
          <span>EMERGENCY STOP (E-STOP)</span>
        </button>
      </div>

      {/* 3. Joint Angles Telemetry */}
      <div className="process-card">
        <div className="process-card-header">
          <div className="card-title">
            <Gauge size={16} className="icon-cyan" />
            <span>6-DOF Joint Angles & End-Effector Stroke</span>
          </div>
          <span className="meta-label">
            Bridge: <code>{wsUrl}</code>
          </span>
        </div>

        <div className="process-card-content">
          <div className="joints-list">
            {jointNames.map((jName, idx) => {
              const rad = jointState?.positions?.[idx] ?? 0.0;
              const deg = ((rad * 180) / Math.PI).toFixed(1);
              const isGripper = idx === 6;
              const normalized = isGripper ? rad / 0.08 : (rad + Math.PI) / (2 * Math.PI);

              return (
                <div key={idx} className="joint-item-card">
                  <div className="joint-label-row">
                    <span className="joint-name">{jName}</span>
                    <span className="joint-values">
                      <strong className="rad-val">{rad.toFixed(3)} {isGripper ? 'm' : 'rad'}</strong>
                      {!isGripper && <span className="deg-val">({deg}°)</span>}
                    </span>
                  </div>

                  {/* Joint Position Bar */}
                  <div className="joint-slider-track">
                    <div
                      className="joint-slider-fill"
                      style={{ width: `${Math.min(100, Math.max(0, normalized * 100))}%` }}
                    />
                    <div
                      className="joint-slider-thumb"
                      style={{ left: `${Math.min(100, Math.max(0, normalized * 100))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

