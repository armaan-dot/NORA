import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X } from 'lucide-react';
import { useDialog } from './useDialog';

type Category = 'handover' | 'move' | 'table' | 'look' | 'arm' | 'refused';

interface CommandItem {
  command: string;
  category: Category;
  /** What the robot actually does, in one or two plain sentences. */
  does: string;
}

const CATEGORIES: { id: Category | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'handover', label: 'Hand to me' },
  { id: 'move', label: 'Move an object' },
  { id: 'table', label: 'Whole table' },
  { id: 'look', label: 'Look' },
  { id: 'arm', label: 'Arm' },
  { id: 'refused', label: 'Refused' }
];

// Every entry was checked against the parser and planner. "Finds" always means the wrist camera finds it.
const COMMANDS: CommandItem[] = [
  { command: 'I want my coffee', category: 'handover', does: 'Works out that you mean the coffee mug, finds it, picks it up and sets it down on the handover mat.' },
  { command: 'I am thirsty', category: 'handover', does: 'Fetches the water glass to the handover mat.' },
  { command: 'Bring me the coffee mug', category: 'handover', does: 'Finds the mug and sets it down on the handover mat.' },
  { command: 'I want to play tennis', category: 'handover', does: 'Works out that you mean the tennis ball and brings it to the handover mat.' },
  { command: 'Pass me the tennis ball', category: 'handover', does: 'Finds the tennis ball and sets it down on the handover mat.' },
  { command: 'Hand me the water glass', category: 'handover', does: 'Finds the glass and sets it down on the handover mat.' },
  { command: 'I am hungry, give me an apple', category: 'handover', does: 'Looks for an apple. There is none on the default table, so it reports that; add one with Add Object first.' },
  { command: 'Find the red cube, pick it up, and move it to the right.', category: 'move', does: 'Needs a red cube on the table. Picks it up and sets it down on a free spot about 15 cm to the right.' },
  { command: 'Move the tennis ball to the right', category: 'move', does: 'Sets the ball down on a free spot about 15 cm to the right of where it was.' },
  { command: 'Put the water glass on the left side', category: 'move', does: 'Sets the glass down on a free spot about 15 cm to the left.' },
  { command: 'Put the coffee mug on the handover mat', category: 'move', does: 'Moves the mug onto a free part of the handover mat.' },
  { command: 'Put the tennis ball in the tray', category: 'move', does: 'Moves the ball into the storage tote.' },
  { command: 'Clean the table', category: 'table', does: 'Surveys the table, puts everything it sees into the tote one at a time, then looks again for anything left.' },
  { command: 'Re-rack the table', category: 'table', does: 'Takes what it sees in the tote and puts each object back on a free spot on the table.' },
  { command: 'Bring me both cups', category: 'table', does: 'Brings the glass and the mug to the handover mat, one after the other.' },
  { command: 'Put all the balls in the tray', category: 'table', does: 'Puts every ball it sees on the table into the tote.' },
  { command: 'Search for the coffee mug', category: 'look', does: 'Moves the camera over the table until it sees the mug, then reports where it is.' },
  { command: 'Find the tennis ball', category: 'look', does: 'Looks for the ball and reports its position, or that it is not on the table.' },
  { command: 'Go home', category: 'arm', does: 'Returns the arm to its parked pose.' },
  { command: 'Open the gripper', category: 'arm', does: 'Opens the fingers fully (85 mm).' },
  { command: 'Close the gripper', category: 'arm', does: 'Closes the fingers until they stop on something or meet.' },
  { command: 'Tell me a funny joke', category: 'refused', does: 'Not a manipulation task: the affordance check scores it below the threshold and the arm does not move.' }
];

interface CommandCatalogueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCommand: (cmd: string) => void;
  isBusy: boolean;
}

export const CommandCatalogueModal: React.FC<CommandCatalogueModalProps> = ({ isOpen, onClose, onSelectCommand, isBusy }) => {
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const dialogRef = useDialog(isOpen, onClose);

  if (!isOpen) return null;

  const q = query.toLowerCase().trim();
  const shown = COMMANDS.filter(
    (c) => (category === 'all' || c.category === category) && (!q || c.command.toLowerCase().includes(q) || c.does.toLowerCase().includes(q))
  );

  const run = (cmd: string) => {
    onSelectCommand(cmd);
    onClose();
  };

  // Rendered into <body> so no container's stacking context can draw over it.
  return createPortal(
    <div className="settings-modal-backdrop cc-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="cc-card" role="dialog" aria-modal="true" aria-labelledby="cc-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header className="cc-header">
          <div>
            <h3 id="cc-title">Commands</h3>
            <p>Examples the robot understands. You can also type your own.</p>
          </div>
          <button className="cc-close" onClick={onClose} aria-label="Close commands">
            <X size={18} />
          </button>
        </header>

        <div className="cc-controls">
          <label className="cc-search">
            <Search size={15} />
            <input aria-label="Search commands" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          </label>
          <div className="cc-filters" aria-label="Categories">
            {CATEGORIES.map((c) => (
              <button key={c.id} className={category === c.id ? 'on' : ''} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <ul className="cc-list">
          {shown.map((c) => (
            <li key={c.command} className="cc-row">
              <div className="cc-text">
                <span className="cc-command">{c.command}</span>
                <span className="cc-does">{c.does}</span>
              </div>
              <button className="cc-run" onClick={() => run(c.command)} title={isBusy ? 'Stops the current task and runs this one' : 'Run this command'}>
                Run
              </button>
            </li>
          ))}
          {!shown.length && <li className="cc-empty">No matching commands.</li>}
        </ul>
      </div>
    </div>,
    document.body
  );
};
