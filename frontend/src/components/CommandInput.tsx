import React, { useState, useEffect } from 'react';
import { Send, Sparkles, X, Loader2, BookOpen, Square, Play, XCircle } from 'lucide-react';
import { rosService } from '../services/rosService';
import type { TabletopObject } from '../types';
import { CommandCatalogueModal } from './CommandCatalogueModal';

interface CommandInputProps {
  isBusy: boolean;
  onCommandSubmit: (cmd: string) => void;
  isStopped?: boolean;
  onStop?: () => void;
  onCancel?: () => void;
}

export const CommandInput: React.FC<CommandInputProps> = ({ isBusy, onCommandSubmit }) => {
  const [inputText, setInputText] = useState('');
  const [customObjects, setCustomObjects] = useState<TabletopObject[]>([]);
  const [isCatalogueOpen, setIsCatalogueOpen] = useState(false);
  const [isStopped, setIsStopped] = useState(false);

  useEffect(() => {
    const unsubObjects = rosService.onObjectsChange((objs) => {
      setCustomObjects(objs.filter((o) => o.isCustom));
    });
    const unsubEStop = rosService.onEStopChange((stopped) => {
      setIsStopped(stopped);
    });
    return () => {
      unsubObjects();
      unsubEStop();
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onCommandSubmit(inputText.trim());
    setInputText('');
  };

  const handleChipClick = (instruction: string) => {
    setInputText(instruction);
    onCommandSubmit(instruction);
  };

  const handleToggleStop = () => {
    if (isStopped) {
      rosService.resetEmergencyStop();
    } else {
      rosService.emergencyStop();
    }
  };

  const handleCancel = async () => {
    await rosService.cancelTask();
  };

  return (
    <div className="command-input-container">
      {/* Main Input Form with Catalogue Button */}
      <form onSubmit={handleSubmit} className="input-form">
        <div className="input-wrapper">
          <button
            type="button"
            className="btn-browse-catalogue"
            onClick={() => setIsCatalogueOpen(true)}
            title="Browse full categorized catalogue of recommended commands"
          >
            <BookOpen size={15} />
            <span>Catalogue</span>
          </button>

          <input
            type="text"
            className="command-text-field"
            placeholder={
              isStopped
                ? 'Emergency Stop engaged — click Resume or Cancel to reset...'
                : isBusy
                ? 'NORA is executing — enter a new command or click Cancel to interrupt...'
                : 'Type a command for NORA (e.g., "I want my coffee", "clean up the table", "pick up the red cube")...'
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />

          {inputText && (
            <button
              type="button"
              className="input-clear-btn"
              onClick={() => setInputText('')}
              title="Clear text"
            >
              <X size={16} />
            </button>
          )}

          {inputText.trim() && (
            <span className="input-enter-hint" title="Press Enter to execute">
              ↵ Enter
            </span>
          )}

          <div className="input-action-buttons">
            <button
              type="submit"
              className="input-send-btn"
              disabled={!inputText.trim()}
              title={isBusy ? 'Execute new command (interrupts current task)' : 'Execute command'}
            >
              {isBusy && !inputText.trim() ? (
                <>
                  <Loader2 size={15} className="spin-icon" />
                  <span>Running</span>
                </>
              ) : (
                <>
                  <Send size={15} />
                  <span>Execute</span>
                </>
              )}
            </button>

            {/* Stop / Resume Button */}
            <button
              type="button"
              className={`btn-cmd-stop ${isStopped ? 'is-stopped' : ''}`}
              onClick={handleToggleStop}
              title={isStopped ? 'Safety interlock engaged: Click to reset and resume' : 'Instant Stop / E-Stop: Freeze arm in place'}
            >
              {isStopped ? (
                <>
                  <Play size={14} />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Square size={13} />
                  <span>Stop</span>
                </>
              )}
            </button>

            {/* Cancel Task Button */}
            <button
              type="button"
              className={`btn-cmd-cancel ${isBusy || isStopped ? 'active-cancel' : ''}`}
              onClick={handleCancel}
              title="Cancel active task, abort execution, and return arm to home position"
            >
              <XCircle size={14} />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      </form>

      {/* Quick Suggestion Chips Bar */}
      <div className="suggestion-chips-bar">
        <span className="chips-label">
          <Sparkles size={12} className="icon-cyan" /> Suggestions:
        </span>
        <div className="chips-scroll">
          {/* Custom added object quick actions */}
          {customObjects.map((obj) => (
            <button
              key={obj.id}
              className="chip-btn chip-custom-obj"
              onClick={() => handleChipClick(`I want my ${obj.name.toLowerCase()}`)}
              title={`Handover ${obj.name}`}
            >
              <span className="dot" style={{ backgroundColor: obj.color, width: 6, height: 6 }} />
              I want my {obj.name}
            </button>
          ))}

          <button
            className="chip-btn chip-highlight"
            onClick={() => handleChipClick('I want to play tennis')}
            title="Infers tennis ball equipment need -> active vision search -> handover"
          >
            🎾 Play tennis
          </button>

          <button
            className="chip-btn chip-highlight"
            onClick={() => handleChipClick('I want my coffee')}
            title="Infers coffee mug -> visual search -> grasp -> handover"
          >
            ☕ Want coffee
          </button>

          <button
            className="chip-btn chip-highlight"
            onClick={() => handleChipClick('clean up the table')}
            title="Sequentially pick and place all objects into storage tray"
          >
            🧹 Clean table
          </button>

          <button
            className="chip-btn"
            onClick={() => handleChipClick('re rack the table')}
            title="Return objects from tray back onto tabletop"
          >
            🔄 Re-rack
          </button>

          <button
            className="chip-btn"
            onClick={() => handleChipClick('I am thirsty')}
            title="Infers water glass -> visual search -> handover"
          >
            🥤 Thirsty
          </button>

          <button
            className="chip-btn chip-guardrail"
            onClick={() => handleChipClick('use the guardrail block')}
            title="Demonstrate SayCan affordance guardrail block (affordance < 0.30, zero arm motion)"
          >
            🛡️ Guardrail Block
          </button>

          <button
            className="chip-btn chip-guardrail"
            onClick={() => handleChipClick('dance for me')}
            title="Tests robot refusal and speech bubble for non-manipulation command"
          >
            🤖 Dance for me (Refusal)
          </button>
        </div>
      </div>

      {/* Command Catalogue Modal */}
      <CommandCatalogueModal
        isOpen={isCatalogueOpen}
        onClose={() => setIsCatalogueOpen(false)}
        onSelectCommand={(cmd) => {
          setInputText(cmd);
          onCommandSubmit(cmd);
        }}
        isBusy={isBusy}
      />
    </div>
  );
};
