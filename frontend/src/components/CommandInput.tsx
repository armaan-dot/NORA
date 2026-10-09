import React, { useState } from 'react';
import { Send, Sparkles, X, Loader2 } from 'lucide-react';

interface CommandInputProps {
  isBusy: boolean;
  onCommandSubmit: (cmd: string) => void;
}

export const CommandInput: React.FC<CommandInputProps> = ({ isBusy, onCommandSubmit }) => {
  const [inputText, setInputText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isBusy) return;
    onCommandSubmit(inputText.trim());
    setInputText('');
  };

  const handleChipClick = (instruction: string) => {
    if (isBusy) return;
    setInputText(instruction);
    onCommandSubmit(instruction);
  };

  return (
    <div className="command-input-container">
      {/* Quick Suggestion Chips */}
      <div className="suggestion-chips-bar">
        <span className="chips-label">
          <Sparkles size={13} /> Quick Presets:
        </span>
        <div className="chips-scroll">
          <button
            className="chip-btn chip-highlight"
            disabled={isBusy}
            onClick={() => handleChipClick('clean up the table')}
          >
            🧹 Clean table (Loop)
          </button>
          <button
            className="chip-btn chip-highlight"
            disabled={isBusy}
            onClick={() => handleChipClick('re rack the table')}
          >
            🔄 Re-rack table (Loop)
          </button>
          <button
            className="chip-btn chip-highlight"
            disabled={isBusy}
            onClick={() => handleChipClick('pick and place twice')}
            title="Generalized count-based loop"
          >
            🔁 Repeat twice (Loop)
          </button>
          <button
            className="chip-btn chip-highlight"
            disabled={isBusy}
            onClick={() => handleChipClick('move both cube and cylinder to tray')}
            title="Generalized multi-object conjunction loop"
          >
            📦 Both cube & cylinder (Loop)
          </button>
          <button
            className="chip-btn"
            disabled={isBusy}
            onClick={() => handleChipClick('I am thirsty')}
          >
            🥤 I am thirsty
          </button>
          <button
            className="chip-btn"
            disabled={isBusy}
            onClick={() => handleChipClick('pick up the red cube')}
          >
            🟥 Pick red cube
          </button>
          <button
            className="chip-btn"
            disabled={isBusy}
            onClick={() => handleChipClick('grab the blue cylinder')}
          >
            🔷 Grab blue cylinder
          </button>
          <button
            className="chip-btn"
            disabled={isBusy}
            onClick={() => handleChipClick('move to the home position')}
          >
            🏠 Return home
          </button>
          <button
            className="chip-btn chip-guardrail"
            disabled={isBusy}
            onClick={() => handleChipClick('I am mored')}
            title="Tests SayCan guardrail rejection on non-robotic input"
          >
            🛡️ "I am mored" (Guardrail)
          </button>
        </div>
      </div>

      {/* Main Input Form */}
      <form onSubmit={handleSubmit} className="input-form">
        <div className="input-wrapper">
          <input
            type="text"
            className="command-text-field"
            placeholder={
              isBusy
                ? 'NORA is currently executing a plan...'
                : 'Type a command for NORA (e.g., "clean up the table", "I am thirsty", "pick up the red cube")...'
            }
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isBusy}
          />

          {inputText && !isBusy && (
            <button
              type="button"
              className="input-clear-btn"
              onClick={() => setInputText('')}
              title="Clear"
            >
              <X size={16} />
            </button>
          )}

          <button
            type="submit"
            className={`input-send-btn ${isBusy ? 'disabled' : ''}`}
            disabled={!inputText.trim() || isBusy}
          >
            {isBusy ? (
              <>
                <Loader2 size={16} className="spin-icon" />
                <span>Running</span>
              </>
            ) : (
              <>
                <Send size={16} />
                <span>Execute</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

