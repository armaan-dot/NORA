import React, { useState } from 'react';
import type {
  Intent,
  AffordanceScore,
  PlanStep,
  OrchestratorFsmState
} from '../types';
import {
  BrainCircuit,
  Scale,
  GitCommit,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react';

interface ProcessTabProps {
  fsmState: OrchestratorFsmState;
  intent: Intent | null;
  affordances: AffordanceScore[];
  plan: PlanStep[];
  activeStepId?: string;
}

export const ProcessTab: React.FC<ProcessTabProps> = ({
  fsmState,
  intent,
  affordances,
  plan,
  activeStepId
}) => {
  const [showRawIntent, setShowRawIntent] = useState(false);

  const isCompleted = fsmState === 'DONE';
  const isFailed = fsmState === 'FAILED';

  return (
    <div className="process-tab-container">
      {/* 1. NLU Section */}
      <div className="process-card">
        <div className="process-card-header">
          <div className="card-title">
            <BrainCircuit size={18} className="icon-cyan" />
            <span>1. NLU (Natural Language Understanding)</span>
          </div>
          <span
            className={`status-pill ${
              intent ? 'pill-success' : fsmState === 'PARSING' ? 'pill-busy' : 'pill-idle'
            }`}
          >
            {fsmState === 'PARSING' ? 'Parsing...' : intent ? 'Extracted' : 'Idle'}
          </span>
        </div>

        {intent ? (
          <div className="process-card-content">
            <div className="intent-meta-grid">
              <div className="meta-box">
                <span className="meta-label">Raw Utterance</span>
                <span className="meta-value highlight">"{intent.raw_text}"</span>
              </div>
              <div className="meta-box">
                <span className="meta-label">Parsed Action</span>
                <span className="meta-tag action-tag">{intent.action}</span>
              </div>
              <div className="meta-box">
                <span className="meta-label">Target Object</span>
                <span className="meta-tag object-tag">
                  {intent.target_object || 'none'}
                </span>
              </div>
              <div className="meta-box">
                <span className="meta-label">Target Location</span>
                <span className="meta-tag location-tag">
                  {intent.target_location || 'none'}
                </span>
              </div>
              <div className="meta-box">
                <span className="meta-label">Confidence</span>
                <span className="meta-value">
                  {(intent.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            {/* Toggle Raw JSON */}
            <div className="raw-json-toggle">
              <button
                type="button"
                className="btn-toggle-json"
                onClick={() => setShowRawIntent(!showRawIntent)}
              >
                {showRawIntent ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                <span>{showRawIntent ? 'Hide JSON Contract' : 'View Intent JSON Contract'}</span>
              </button>

              {showRawIntent && (
                <pre className="json-viewer">
                  {JSON.stringify(intent, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ) : (
          <div className="empty-placeholder">
            <span>Enter an instruction below to see how NLU extracts robotic intent.</span>
          </div>
        )}
      </div>

      {/* 2. Affordance Scoring (SayCan) */}
      <div className="process-card">
        <div className="process-card-header">
          <div className="card-title">
            <Scale size={18} className="icon-amber" />
            <span>2. Affordance Scoring (SayCan Model)</span>
          </div>
          <span
            className={`status-pill ${
              affordances.length > 0
                ? 'pill-success'
                : fsmState === 'SCORING'
                ? 'pill-busy'
                : 'pill-idle'
            }`}
          >
            {fsmState === 'SCORING' ? 'Scoring...' : affordances.length > 0 ? 'Ranked' : 'Idle'}
          </span>
        </div>

        {affordances.length > 0 ? (
          <div className="process-card-content">
            <div className="formula-callout">
              <span>SayCan Formulation:</span>
              <code>Combined Score = (Usefulness)^0.6 × (Feasibility)^0.4</code>
            </div>

            <div className="affordance-bars-list">
              {affordances.map((aff, idx) => {
                const percent = Math.round(aff.combined_score * 100);
                const isWinner = idx === 0;

                return (
                  <div
                    key={aff.skill_name}
                    className={`affordance-row ${isWinner ? 'winner-row' : ''}`}
                  >
                    <div className="row-header">
                      <div className="skill-name-wrap">
                        <span className="skill-title">{aff.skill_name}</span>
                        {isWinner && <span className="winner-badge">Selected Skill</span>}
                      </div>
                      <div className="score-breakdown-details">
                        <span>
                          Usefulness: <strong>{aff.usefulness.toFixed(2)}</strong>
                        </span>
                        <span>•</span>
                        <span>
                          Feasibility: <strong>{aff.feasibility.toFixed(2)}</strong>
                        </span>
                        <span>•</span>
                        <span className="combined-bold">
                          Combined: <strong>{aff.combined_score.toFixed(3)}</strong>
                        </span>
                      </div>
                    </div>

                    <div className="progress-bar-bg">
                      <div
                        className={`progress-bar-fill ${isWinner ? 'fill-winner' : ''}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="empty-placeholder">
            <span>Affordance evaluation will calculate usefulness × physical feasibility.</span>
          </div>
        )}
      </div>

      {/* 3. Skill Execution Plan */}
      <div className="process-card">
        <div className="process-card-header">
          <div className="card-title">
            <GitCommit size={18} className="icon-emerald" />
            <span>3. Orchestration & Skill Execution Plan</span>
          </div>
          <span
            className={`status-pill ${
              isCompleted
                ? 'pill-done'
                : isFailed
                ? 'pill-fail'
                : plan.length > 0
                ? 'pill-busy'
                : 'pill-idle'
            }`}
          >
            {fsmState}
          </span>
        </div>

        {plan.length > 0 ? (
          <div className="process-card-content">
            <div className="steps-pipeline">
              {plan.map((step, idx) => {
                const isRunning = step.id === activeStepId || step.status === 'running';
                const isDone = step.status === 'completed';
                const showLoopHeader =
                  step.loopGroup &&
                  (idx === 0 || plan[idx - 1].loopGroup !== step.loopGroup);

                return (
                  <React.Fragment key={step.id}>
                    {showLoopHeader && (
                      <div className="loop-group-divider">
                        <div className="loop-badge">
                          <span className="loop-dot" />
                          <span className="loop-title">{step.loopGroup}</span>
                        </div>
                      </div>
                    )}
                    <div
                      className={`step-card ${
                        isRunning ? 'step-running' : isDone ? 'step-completed' : 'step-pending'
                      }`}
                    >
                      <div className="step-indicator">
                        {isDone ? (
                          <CheckCircle2 size={18} className="icon-emerald" />
                        ) : isRunning ? (
                          <div className="spinner-mini" />
                        ) : (
                          <Clock size={16} className="icon-muted" />
                        )}
                        <span className="step-number">Step {idx + 1}</span>
                      </div>

                      <div className="step-body">
                        <div className="step-title-row">
                          <span className="step-skill-name">{step.skill}</span>
                          <span className={`step-status-tag tag-${step.status}`}>
                            {step.status}
                          </span>
                        </div>
                        <p className="step-detail-text">{step.detail}</p>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {isCompleted && (
              <div className="task-completion-banner">
                <CheckCircle2 size={20} className="icon-emerald" />
                <div>
                  <strong>Program Execution Finished Successfully</strong>
                  <p>All scheduled skills dispatched and executed on arm controllers.</p>
                </div>
              </div>
            )}

            {isFailed && (
              <div className="task-failed-banner">
                <AlertCircle size={20} className="icon-red" />
                <div>
                  <strong>Task Execution Halted</strong>
                  <p>A skill failed preconditions or planning limits were reached.</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="process-card-content">
            {isFailed || intent?.action === 'unknown' ? (
              <div className="task-failed-banner">
                <AlertCircle size={22} className="icon-red" />
                <div>
                  <strong>SayCan Guardrail Triggered: Command Rejected</strong>
                  <p>
                    The input <em>"{intent?.raw_text}"</em> does not map to any supported physical robotics skill (action is <code>unknown</code>).
                    All candidate skills scored below the physical affordance threshold (0.30).
                    The arm safely remains in idle position to prevent ungrounded actions.
                  </p>
                </div>
              </div>
            ) : (
              <div className="empty-placeholder">
                <span>The ordered skill execution plan will be displayed here as it executes.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

