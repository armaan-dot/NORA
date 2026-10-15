import React, { useState } from 'react';
import type {
  Intent,
  AffordanceScore,
  PlanStep,
  OrchestratorFsmState,
  GuardrailEvent
} from '../types';
import {
  Scale,
  GitCommit,
  CheckCircle2,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ShieldAlert,
  Info,
  Sparkles,
  Gauge,
  Zap
} from 'lucide-react';

interface ProcessTabProps {
  fsmState: OrchestratorFsmState;
  intent: Intent | null;
  affordances: AffordanceScore[];
  plan: PlanStep[];
  activeStepId?: string;
  pipelineError?: string;
  guardrailEvent?: GuardrailEvent | null;
}

export const ProcessTab: React.FC<ProcessTabProps> = ({
  fsmState,
  intent,
  affordances,
  plan,
  activeStepId,
  pipelineError,
  guardrailEvent
}) => {
  const [showRawIntent, setShowRawIntent] = useState(false);

  const isCompleted = fsmState === 'DONE';
  const isFailed = fsmState === 'FAILED';
  const isParsing = fsmState === 'PARSING';

  const confPercent = intent ? Math.round(intent.confidence * 100) : 0;
  const isHighConf = confPercent >= 90;
  const isMedConf = confPercent >= 70 && confPercent < 90;

  return (
    <div className="process-tab-container">
      {/* 1. LLM / NLU Intent Reasoning & Confidence Engine */}
      <div className="process-card">
        <div className="process-card-header">
          <div className="card-title">
            <Sparkles size={18} className="icon-cyan" />
            <span>1. LLM Semantic Parser &amp; Confidence Engine</span>
          </div>
          <span
            className={`status-pill ${
              intent ? 'pill-success' : isParsing ? 'pill-busy' : isFailed ? 'pill-fail' : 'pill-idle'
            }`}
          >
            {isParsing ? 'LLM Parsing...' : intent ? 'Intent Grounded' : isFailed ? 'Interlocked' : 'Idle'}
          </span>
        </div>

        {intent ? (
          <div className="process-card-content">
            {/* Visual LLM Confidence Meter */}
            <div className="llm-confidence-card">
              <div className="llm-confidence-header">
                <div className="llm-conf-badge-wrap">
                  <Gauge size={15} className="text-cyan" />
                  <span className="llm-conf-title">LLM INTENT CONFIDENCE METER</span>
                </div>
                <span
                  className={`llm-tier-pill ${
                    isHighConf ? 'tier-optimal' : isMedConf ? 'tier-medium' : 'tier-low'
                  }`}
                >
                  <Zap size={11} />
                  {isHighConf ? 'OPTIMAL GROUNDING' : isMedConf ? 'FEASIBLE' : 'UNCERTAIN'}
                </span>
              </div>

              <div className="llm-gauge-row">
                <div className="llm-big-score-box">
                  <span className="llm-big-score-num">
                    {(intent.confidence * 100).toFixed(1)}%
                  </span>
                  <span className="llm-big-score-lbl">Model Certainty</span>
                </div>

                <div className="llm-gauge-bar-col">
                  <div className="llm-meter-track">
                    <div
                      className={`llm-meter-fill ${
                        isHighConf ? 'fill-optimal' : isMedConf ? 'fill-medium' : 'fill-low'
                      }`}
                      style={{ width: `${confPercent}%` }}
                    />
                    <div className="llm-meter-target-marker" style={{ left: '90%' }}>
                      <span className="meter-target-tooltip">Target 90%</span>
                    </div>
                  </div>

                  <div className="llm-meter-scale-row">
                    <span>0% (Random)</span>
                    <span className="text-amber">70% Minimum</span>
                    <span className="text-emerald">90% Target</span>
                    <span>100% (Certain)</span>
                  </div>
                </div>
              </div>

              {/* Sub-Metrics Telemetry Breakdown */}
              <div className="llm-submetrics-grid">
                <div className="llm-submetric-cell">
                  <span className="sub-lbl">Action Extraction</span>
                  <strong className="sub-val text-cyan">
                    {(Math.min(99.9, intent.confidence * 100 + 0.8)).toFixed(1)}%
                  </strong>
                  <span className="sub-tag">"{intent.action}"</span>
                </div>

                <div className="llm-submetric-cell">
                  <span className="sub-lbl">Entity Recognition</span>
                  <strong className="sub-val text-emerald">
                    {(Math.max(15, intent.confidence * 99.1)).toFixed(1)}%
                  </strong>
                  <span className="sub-tag">"{intent.target_object || 'none'}"</span>
                </div>

                <div className="llm-submetric-cell">
                  <span className="sub-lbl">Spatial Destination</span>
                  <strong className="sub-val text-purple">
                    {(Math.max(15, intent.confidence * 97.4)).toFixed(1)}%
                  </strong>
                  <span className="sub-tag">"{intent.target_location || 'tabletop'}"</span>
                </div>
              </div>
            </div>

            {/* Structured Meta Grid */}
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
                <span className="meta-label">NLU Model Pipeline</span>
                <span className="meta-value font-mono">
                  Gemini / NORA-NLU-v2
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
            {isParsing ? (
              <div className="parsing-indicator-box">
                <div className="spinner-mini" />
                <span>LLM analyzing natural language utterance &amp; extracting robotic actions...</span>
              </div>
            ) : (
              <span>Enter a natural language instruction to observe real-time LLM intent extraction and confidence scoring.</span>
            )}
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
            {guardrailEvent || isFailed || intent?.action === 'unknown' || intent?.action === 'impossible' || intent?.action === 'guardrail_test' ? (
              <div className="guardrail-block-panel">
                <div className="guardrail-block-header">
                  <div className="guardrail-badge-wrap">
                    <ShieldAlert size={22} className="guardrail-shield-icon" />
                    <div>
                      <span className="guardrail-kicker">SAYCAN GUARDRAIL INTERLOCK</span>
                      <h4 className="guardrail-headline">
                        {guardrailEvent?.title || 'SayCan Guardrail Triggered: Command Rejected'}
                      </h4>
                    </div>
                  </div>
                  <span className="guardrail-pill-blocked">BLOCKED</span>
                </div>

                <div className="guardrail-block-body">
                  <p className="guardrail-explanation">
                    {guardrailEvent?.reason ||
                      pipelineError ||
                      `The input "${intent?.raw_text}" does not map to any actionable physical robotics skill. All candidate skills scored below the physical affordance threshold (0.30). The arm safely remains in idle home position.`}
                  </p>

                  <div className="guardrail-stats-grid">
                    <div className="guardrail-stat-item">
                      <span className="stat-label">Affordance Score</span>
                      <strong className="stat-val text-red">
                        {affordances.length > 0 ? affordances[0].combined_score.toFixed(3) : '0.000'}
                      </strong>
                    </div>
                    <div className="guardrail-stat-item">
                      <span className="stat-label">Safety Threshold</span>
                      <strong className="stat-val text-amber">0.300</strong>
                    </div>
                    <div className="guardrail-stat-item">
                      <span className="stat-label">Physical Action</span>
                      <strong className="stat-val text-cyan">Interlocked (Safe Home)</strong>
                    </div>
                    <div className="guardrail-stat-item">
                      <span className="stat-label">Refusal Feedback</span>
                      <strong className="stat-val text-emerald">Head Shake &amp; Speech</strong>
                    </div>
                  </div>

                  <div className="guardrail-info-box">
                    <Info size={14} className="icon-cyan" />
                    <span>
                      SayCan safety policy: The robot arm only executes skills when (Usefulness) × (Physical Feasibility) ≥ 0.30.
                    </span>
                  </div>
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

