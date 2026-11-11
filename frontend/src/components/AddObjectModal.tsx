import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { rosService } from '../services/rosService';
import { physicsFor } from '../sim/objectPhysics';
import type { TabletopObject } from '../types';

interface AddObjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onObjectAdded?: (obj: TabletopObject) => void;
}
type ObjectShape = 'box' | 'cylinder' | 'sphere' | 'glass' | 'mug' | 'apple';
type SpawnZone = 'auto' | 'center' | 'left' | 'right' | 'user';
type Category = 'Drinks' | 'Food' | 'Stationery' | 'Shapes';
interface Preset { name: string; shape: ObjectShape; color: string; category: Category }
const PRESETS: Preset[] = [
  { name: 'Coffee Mug', shape: 'mug', color: '#8b4513', category: 'Drinks' },
  { name: 'Water Glass', shape: 'glass', color: '#38bdf8', category: 'Drinks' },
  { name: 'Tea Cup', shape: 'mug', color: '#10b981', category: 'Drinks' },
  { name: 'Red Apple', shape: 'apple', color: '#e11d48', category: 'Food' },
  { name: 'Green Apple', shape: 'apple', color: '#65a30d', category: 'Food' },
  { name: 'Orange Fruit', shape: 'sphere', color: '#f97316', category: 'Food' },
  { name: 'Writing Pen', shape: 'cylinder', color: '#2563eb', category: 'Stationery' },
  { name: 'Yellow Pencil', shape: 'cylinder', color: '#f59e0b', category: 'Stationery' },
  { name: 'Highlighter', shape: 'cylinder', color: '#eab308', category: 'Stationery' },
  { name: 'Notebook', shape: 'box', color: '#3b82f6', category: 'Stationery' },
  { name: 'Desk Ruler', shape: 'box', color: '#cbd5e1', category: 'Stationery' },
  { name: 'Office Scissors', shape: 'box', color: '#64748b', category: 'Stationery' },
  { name: 'Paper Stapler', shape: 'box', color: '#475569', category: 'Stationery' },
  { name: 'Pink Eraser', shape: 'box', color: '#f43f5e', category: 'Stationery' },
  { name: 'Yellow Box', shape: 'box', color: '#eab308', category: 'Shapes' },
  { name: 'Blue Package', shape: 'box', color: '#2563eb', category: 'Shapes' },
  { name: 'Purple Canister', shape: 'cylinder', color: '#a855f7', category: 'Shapes' },
  { name: 'Tennis Ball', shape: 'sphere', color: '#84cc16', category: 'Shapes' }
];

export const AddObjectModal: React.FC<AddObjectModalProps> = ({ isOpen, onClose, onObjectAdded }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [name, setName] = useState('Coffee Mug');
  const [shape, setShape] = useState<ObjectShape>('mug');
  const [color, setColor] = useState('#8b4513');
  const [zone, setZone] = useState<SpawnZone>('auto');
  const [keepOpen, setKeepOpen] = useState(true);
  const [massKg, setMassKg] = useState('');
  const [status, setStatus] = useState('');
  const [objects, setObjects] = useState<TabletopObject[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    setStatus('');
    const previous = document.activeElement as HTMLElement | null;
    const unsubscribe = rosService.onObjectsChange((items) => setObjects([...items]));
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { unsubscribe(); previous?.focus(); };
  }, [isOpen]);
  if (!isOpen) return null;
  const spec = physicsFor({ name, shape });
  const mass = spec.colliders.reduce((total, c) => total + c.mass, 0);
  const filtered = PRESETS.filter(p => (category === 'All' || p.category === category) && p.name.toLowerCase().includes(query.toLowerCase().trim()));
  const busy = rosService.isTaskExecuting();
  const select = (preset: Preset) => { setName(preset.name); setShape(preset.shape); setColor(preset.color); setStatus(''); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || rosService.isTaskExecuting()) return;
    const customMass = Number(massKg);
    const obj = rosService.addObject({ name: name.trim(), shape, color, zone, mass: massKg && customMass > 0 ? customMass : undefined });
    onObjectAdded?.(obj);
    setStatus(`Added ${obj.name}.`);
    if (!keepOpen) onClose();
  };
  const keyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key !== 'Tab') return;
    const focusable = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)');
    if (!focusable?.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="ao-card" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="objects-title" onKeyDown={keyDown} onClick={e => e.stopPropagation()}>
        <header className="ao-header">
          <div><h3 id="objects-title">Objects</h3><p>Select an item or edit its name, shape and colour.</p></div>
          <button className="ao-close" onClick={onClose} aria-label="Close objects"><X size={18} /></button>
        </header>
        <div className="ao-body">
          <section className="ao-library" aria-label="Object library">
            <div className="ao-toolbar">
              <label className="ao-search"><Search size={15} /><input aria-label="Search objects" placeholder="Search objects" value={query} onChange={e => setQuery(e.target.value)} /></label>
              <div className="ao-segment" aria-label="Categories">
                {['All', 'Drinks', 'Food', 'Stationery', 'Shapes'].map(c => <button key={c} aria-pressed={category === c} className={category === c ? 'on' : ''} onClick={() => setCategory(c)}>{c}</button>)}
              </div>
            </div>
            <ul className="ao-list">
              {filtered.map(p => <li key={p.name}><button className={`ao-item ${name === p.name && shape === p.shape && color === p.color ? 'selected' : ''}`} aria-pressed={name === p.name && shape === p.shape && color === p.color} onClick={() => select(p)}>
                <span className="ao-chip" style={{ background: p.color }} /><span className="ao-item-name">{p.name}</span><span className="ao-item-meta">{Math.round(physicsFor(p).colliders.reduce((s, c) => s + c.mass, 0) * 1000)} g</span>
              </button></li>)}
              {!filtered.length && <li className="ao-empty">No matching objects. Use the form to add your own.</li>}
            </ul>
          </section>
          <form className="ao-side" onSubmit={submit}>
            <label className="ao-field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></label>
            <div className="ao-form-row">
              <label className="ao-field"><span>Shape</span><select value={shape} onChange={e => setShape(e.target.value as ObjectShape)}>{['box', 'cylinder', 'sphere', 'glass', 'mug', 'apple'].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
              <label className="ao-field"><span>Colour</span><input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
            </div>
            <label className="ao-field"><span>Placement</span><select value={zone} onChange={e => setZone(e.target.value as SpawnZone)}>{Object.entries({ auto: 'Available space', center: 'Centre', left: 'Left', right: 'Right', user: 'Handover mat' }).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
            <dl className="ao-properties"><div><dt><label htmlFor="ao-mass">Mass (kg)</label></dt><dd><input id="ao-mass" className="ao-mass" type="number" min="0.01" max="60" step="0.01" placeholder={mass.toFixed(2)} value={massKg} onChange={e => setMassKg(e.target.value)} /></dd></div><div><dt>Surface friction</dt><dd>{spec.friction.toFixed(2)}</dd></div><div><dt>Restitution</dt><dd>{spec.restitution.toFixed(2)}</dd></div></dl>
            <p className="ao-note">Physical properties use the model matched to the name and shape. Leave mass blank for its real mass; a heavier one tests grip slip (above about 8 kg) and joint torque limits.</p>
            <label className="ao-check"><input type="checkbox" checked={keepOpen} onChange={e => setKeepOpen(e.target.checked)} />Keep open after adding</label>
            <button className="ao-primary" type="submit" disabled={!name.trim() || busy}>{busy ? 'Task running' : 'Add to workspace'}</button>
          </form>
        </div>
        <footer className="ao-footer">
          <div className="ao-footer-head"><span>In workspace <strong>{objects.length}</strong></span><span className="ao-status" role="status">{status}</span><div className="ao-footer-actions">
            <button disabled={busy} onClick={() => { rosService.resetToDefaultObjects(); setStatus('Default objects restored.'); }}>Reset</button>
            <button disabled={busy || !objects.length} onClick={() => { rosService.clearAllObjects(); setStatus('Workspace cleared.'); }}>Clear</button>
          </div></div>
          <ul className="ao-chips">{objects.map(o => <li className="ao-obj" key={o.id}><span className="ao-chip" style={{ background: o.color }} /><span>{o.name}</span><button disabled={busy} aria-label={`Remove ${o.name}`} onClick={() => { rosService.removeObject(o.id); setStatus(`Removed ${o.name}.`); }}><X size={13} /></button></li>)}{!objects.length && <li className="ao-empty">No objects in the workspace.</li>}</ul>
        </footer>
      </div>
    </div>
  );
};
