import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Box,
  Circle,
  Cylinder as CylinderIcon,
  Wine,
  Coffee,
  Sparkles,
  Check,
  MapPin,
  Eye,
  Sliders,
  Trash2,
  RotateCcw
} from 'lucide-react';
import { rosService } from '../services/rosService';
import type { TabletopObject } from '../types';

interface AddObjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onObjectAdded?: (obj: TabletopObject) => void;
}

type ObjectShape = 'box' | 'cylinder' | 'sphere' | 'glass' | 'mug' | 'apple';
type SpawnZone = 'auto' | 'center' | 'left' | 'right' | 'user';

interface PresetItem {
  name: string;
  shape: ObjectShape;
  color: string;
  emoji: string;
  category: 'drinks' | 'food' | 'stationery' | 'primitives';
  desc: string;
}

const PRESETS: PresetItem[] = [
  // Drinks & Mugs
  { name: 'Coffee Mug', shape: 'mug', color: '#8B4513', emoji: '☕', category: 'drinks', desc: 'Ceramic mug with fresh brew' },
  { name: 'Water Glass', shape: 'glass', color: '#38bdf8', emoji: '🥤', category: 'drinks', desc: 'Clear glass of drinking water' },
  { name: 'Tea Cup', shape: 'mug', color: '#10b981', emoji: '🍵', category: 'drinks', desc: 'Green tea porcelain mug' },

  // Food & Fruits
  { name: 'Red Apple', shape: 'apple', color: '#e11d48', emoji: '🍎', category: 'food', desc: 'Fresh apple with stem & leaf' },
  { name: 'Green Apple', shape: 'apple', color: '#65a30d', emoji: '🍏', category: 'food', desc: 'Crisp granny smith apple' },
  { name: 'Orange Fruit', shape: 'sphere', color: '#f97316', emoji: '🍊', category: 'food', desc: 'Citrus tabletop fruit' },

  // Stationery & Office Supplies
  { name: 'Writing Pen', shape: 'cylinder', color: '#2563eb', emoji: '🖊️', category: 'stationery', desc: 'Blue ballpoint desk pen' },
  { name: 'Yellow Pencil', shape: 'cylinder', color: '#f59e0b', emoji: '✏️', category: 'stationery', desc: 'Sharpened graphite pencil' },
  { name: 'Neon Highlighter', shape: 'cylinder', color: '#eab308', emoji: '🖍️', category: 'stationery', desc: 'Vibrant text highlighter' },
  { name: 'Notebook Journal', shape: 'box', color: '#3b82f6', emoji: '📓', category: 'stationery', desc: 'Hardcover notes sketchbook' },
  { name: 'Desk Ruler', shape: 'box', color: '#cbd5e1', emoji: '📏', category: 'stationery', desc: 'Clear metric measurement ruler' },
  { name: 'Office Scissors', shape: 'box', color: '#64748b', emoji: '✂️', category: 'stationery', desc: 'Stainless steel cutting scissors' },
  { name: 'Paper Stapler', shape: 'box', color: '#475569', emoji: '📎', category: 'stationery', desc: 'Desktop document stapler' },
  { name: 'Pink Eraser', shape: 'box', color: '#f43f5e', emoji: '🧼', category: 'stationery', desc: 'Rubber pencil eraser block' },

  // Workspace Primitives
  { name: 'Yellow Box', shape: 'box', color: '#eab308', emoji: '🟨', category: 'primitives', desc: 'Standard manipulation cube' },
  { name: 'Blue Package', shape: 'box', color: '#2563eb', emoji: '📦', category: 'primitives', desc: 'Courier packaging box' },
  { name: 'Purple Canister', shape: 'cylinder', color: '#a855f7', emoji: '🟣', category: 'primitives', desc: 'Industrial cylinder canister' },
  { name: 'Tennis Ball', shape: 'sphere', color: '#84cc16', emoji: '🎾', category: 'primitives', desc: 'Soft spherical tennis ball' }
];

const COLOR_SWATCHES = [
  { name: 'Ceramic Brown', color: '#8B4513' },
  { name: 'Ruby Crimson', color: '#e11d48' },
  { name: 'Sunset Amber', color: '#f59e0b' },
  { name: 'Solar Yellow', color: '#eab308' },
  { name: 'Mint Emerald', color: '#10b981' },
  { name: 'Electric Cyan', color: '#00f0ff' },
  { name: 'Cobalt Blue', color: '#3b82f6' },
  { name: 'Neon Purple', color: '#a855f7' },
  { name: 'Ghost White', color: '#f8fafc' },
  { name: 'Dark Slate', color: '#334155' }
];

export const AddObjectModal: React.FC<AddObjectModalProps> = ({ isOpen, onClose, onObjectAdded }) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'drinks' | 'food' | 'stationery' | 'primitives'>('all');
  const [name, setName] = useState('Coffee Mug');
  const [shape, setShape] = useState<ObjectShape>('mug');
  const [color, setColor] = useState('#8B4513');
  const [zone, setZone] = useState<SpawnZone>('auto');
  const [keepOpen, setKeepOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [currentObjects, setCurrentObjects] = useState<TabletopObject[]>(rosService.getObjects());

  useEffect(() => {
    if (isOpen) {
      setCurrentObjects(rosService.getObjects());
      const un = rosService.onObjectsChange((objs) => {
        setCurrentObjects([...objs]);
      });
      return () => un();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDeleteObject = (id: string, objName: string) => {
    rosService.removeObject(id);
    setSuccessMsg(`Deleted "${objName}" from tabletop.`);
    setTimeout(() => setSuccessMsg(null), 2000);
  };

  const handleClearAll = () => {
    rosService.clearAllObjects();
    setSuccessMsg('Deleted all objects from tabletop.');
    setTimeout(() => setSuccessMsg(null), 2000);
  };

  const handleRestoreDefaults = () => {
    rosService.resetToDefaultObjects();
    setSuccessMsg('Restored default tabletop items.');
    setTimeout(() => setSuccessMsg(null), 2000);
  };

  const handleAddPreset = (preset: PresetItem) => {
    const newObj = rosService.addObject({
      name: preset.name,
      shape: preset.shape,
      color: preset.color,
      zone
    });
    setSuccessMsg(`Spawned "${preset.name}" in ${zone.toUpperCase()} zone!`);
    onObjectAdded?.(newObj);

    if (!keepOpen) {
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 500);
    } else {
      setTimeout(() => setSuccessMsg(null), 2500);
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newObj = rosService.addObject({
      name: name.trim(),
      shape,
      color,
      zone
    });
    setSuccessMsg(`Spawned "${name.trim()}" in ${zone.toUpperCase()} zone!`);
    onObjectAdded?.(newObj);

    if (!keepOpen) {
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 500);
    } else {
      setTimeout(() => setSuccessMsg(null), 2500);
    }
  };

  const filteredPresets = selectedCategory === 'all'
    ? PRESETS
    : PRESETS.filter((p) => p.category === selectedCategory);

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="add-object-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header-row">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge">
              <Plus size={18} className="icon-cyan" />
            </div>
            <div>
              <h3>Add Physical Workspace Object</h3>
              <p className="modal-subtitle">Spawn tabletop items with 3D geometry & collision detection</p>
            </div>
          </div>
          <button className="btn-close-modal" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Success Alert Banner */}
        {successMsg && (
          <div className="add-success-banner">
            <Check size={16} className="icon-emerald" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Current Tabletop Inventory & Delete Strip */}
        <div className="modal-current-objects-strip">
          <div className="current-objects-header">
            <div className="section-label-row">
              <Box size={14} className="icon-cyan" />
              <span>Current Objects on Table ({currentObjects.length}):</span>
            </div>
            <div className="current-objects-actions">
              {currentObjects.length > 0 ? (
                <button
                  type="button"
                  className="btn-modal-clear-all"
                  onClick={handleClearAll}
                  title="Remove all objects from tabletop (including default items)"
                >
                  <Trash2 size={12} />
                  <span>Delete All Objects</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-modal-restore-defaults"
                  onClick={handleRestoreDefaults}
                  title="Restore default tabletop items (Red Cube, Blue Cylinder, Green Sphere, Water Glass)"
                >
                  <RotateCcw size={12} />
                  <span>Restore Defaults</span>
                </button>
              )}
            </div>
          </div>

          <div className="current-objects-pill-list">
            {currentObjects.length === 0 ? (
              <span className="current-objects-empty">No objects currently on table. Spawn from library below!</span>
            ) : (
              currentObjects.map((obj) => (
                <div key={obj.id} className="current-obj-pill">
                  <span className="dot" style={{ backgroundColor: obj.color }} />
                  <span className="current-obj-name">{obj.name}</span>
                  <button
                    type="button"
                    className="btn-pill-delete"
                    onClick={() => handleDeleteObject(obj.id, obj.name)}
                    title={`Delete ${obj.name}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Global Zone Selector & Multi-Add Option */}
        <div className="modal-config-strip">
          <div className="config-strip-item">
            <span className="strip-label">
              <MapPin size={13} className="icon-cyan" />
              <span>Target Spawn Zone:</span>
            </span>
            <div className="zone-pill-selector">
              <button
                type="button"
                className={`zone-pill ${zone === 'auto' ? 'active' : ''}`}
                onClick={() => setZone('auto')}
                title="Automatically finds an open, collision-free tabletop area"
              >
                Auto Open Space
              </button>
              <button
                type="button"
                className={`zone-pill ${zone === 'center' ? 'active' : ''}`}
                onClick={() => setZone('center')}
                title="Primary central workspace area"
              >
                Center
              </button>
              <button
                type="button"
                className={`zone-pill ${zone === 'left' ? 'active' : ''}`}
                onClick={() => setZone('left')}
                title="Left workspace storage area"
              >
                Left
              </button>
              <button
                type="button"
                className={`zone-pill ${zone === 'right' ? 'active' : ''}`}
                onClick={() => setZone('right')}
                title="Right workspace assembly area"
              >
                Right
              </button>
              <button
                type="button"
                className={`zone-pill ${zone === 'user' ? 'active' : ''}`}
                onClick={() => setZone('user')}
                title="Near front edge for user handover"
              >
                User Handover
              </button>
            </div>
          </div>

          <label className="keep-open-toggle" title="Keep dialog open after adding so you can add multiple items">
            <input
              type="checkbox"
              checked={keepOpen}
              onChange={(e) => setKeepOpen(e.target.checked)}
            />
            <span>Keep open for multiple items</span>
          </label>
        </div>

        {/* Category Tabs & Quick Presets */}
        <div className="modal-section">
          <div className="preset-header-row">
            <div className="section-label-row">
              <Sparkles size={14} className="icon-amber" />
              <span>Quick 1-Click Library:</span>
            </div>
            <div className="category-filter-tabs">
              <button
                type="button"
                className={`category-tab ${selectedCategory === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('all')}
              >
                All ({PRESETS.length})
              </button>
              <button
                type="button"
                className={`category-tab ${selectedCategory === 'drinks' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('drinks')}
              >
                ☕ Drinks
              </button>
              <button
                type="button"
                className={`category-tab ${selectedCategory === 'food' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('food')}
              >
                🍎 Food
              </button>
              <button
                type="button"
                className={`category-tab ${selectedCategory === 'stationery' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('stationery')}
              >
                🖊️ Stationery
              </button>
              <button
                type="button"
                className={`category-tab ${selectedCategory === 'primitives' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('primitives')}
              >
                📦 Shapes
              </button>
            </div>
          </div>

          <div className="presets-grid">
            {filteredPresets.map((p) => (
              <button
                key={p.name}
                type="button"
                className="preset-card-btn"
                onClick={() => handleAddPreset(p)}
                title={`Spawn ${p.name} (${p.desc})`}
              >
                <div className="preset-card-top">
                  <span className="preset-emoji">{p.emoji}</span>
                  <span
                    className="preset-swatch-dot"
                    style={{ backgroundColor: p.color }}
                  />
                </div>
                <span className="preset-name">{p.name}</span>
                <span className="preset-desc">{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Object Creator */}
        <div className="modal-section custom-builder-section">
          <div className="section-label-row">
            <Sliders size={14} className="icon-cyan" />
            <span>Custom Object Builder:</span>
          </div>

          <form onSubmit={handleCustomSubmit} className="custom-builder-form">
            <div className="custom-form-grid">
              {/* Left Column: Form Fields */}
              <div className="custom-form-fields">
                <div className="form-group">
                  <label>Object Name / Voice Utterance:</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., My Coffee Mug, Fresh Apple, Box..."
                    className="modal-text-input"
                    required
                  />
                </div>

                {/* 3D Physical Shape Picker */}
                <div className="form-group">
                  <label>3D Physical Geometry:</label>
                  <div className="shape-picker-grid">
                    <button
                      type="button"
                      className={`shape-select-btn ${shape === 'mug' ? 'active' : ''}`}
                      onClick={() => {
                        setShape('mug');
                        if (name === 'Yellow Box' || name === 'Fresh Apple') setName('Coffee Mug');
                      }}
                      title="Ceramic Coffee Mug with handle & dark coffee inside"
                    >
                      <Coffee size={18} />
                      <span>Coffee Mug</span>
                    </button>

                    <button
                      type="button"
                      className={`shape-select-btn ${shape === 'apple' ? 'active' : ''}`}
                      onClick={() => {
                        setShape('apple');
                        if (name === 'Coffee Mug' || name === 'Yellow Box') setName('Red Apple');
                      }}
                      title="Fresh fruit with natural stem & leaf"
                    >
                      <Circle size={18} />
                      <span>Apple / Fruit</span>
                    </button>

                    <button
                      type="button"
                      className={`shape-select-btn ${shape === 'glass' ? 'active' : ''}`}
                      onClick={() => {
                        setShape('glass');
                        if (name === 'Coffee Mug' || name === 'Red Apple') setName('Water Glass');
                      }}
                      title="Clear drinking glass"
                    >
                      <Wine size={18} />
                      <span>Water Glass</span>
                    </button>

                    <button
                      type="button"
                      className={`shape-select-btn ${shape === 'box' ? 'active' : ''}`}
                      onClick={() => {
                        setShape('box');
                        if (name === 'Coffee Mug' || name === 'Red Apple') setName('Storage Box');
                      }}
                      title="Manipulation cube or package"
                    >
                      <Box size={18} />
                      <span>Cube / Box</span>
                    </button>

                    <button
                      type="button"
                      className={`shape-select-btn ${shape === 'cylinder' ? 'active' : ''}`}
                      onClick={() => setShape('cylinder')}
                      title="Canister or cylinder"
                    >
                      <CylinderIcon size={18} />
                      <span>Cylinder</span>
                    </button>

                    <button
                      type="button"
                      className={`shape-select-btn ${shape === 'sphere' ? 'active' : ''}`}
                      onClick={() => setShape('sphere')}
                      title="Spherical ball"
                    >
                      <Circle size={18} />
                      <span>Sphere</span>
                    </button>
                  </div>
                </div>

                {/* Color Swatches */}
                <div className="form-group">
                  <label>Material Color:</label>
                  <div className="color-swatches-row">
                    {COLOR_SWATCHES.map((swatch) => (
                      <button
                        key={swatch.color}
                        type="button"
                        className={`swatch-circle ${color === swatch.color ? 'active' : ''}`}
                        style={{ backgroundColor: swatch.color }}
                        onClick={() => setColor(swatch.color)}
                        title={swatch.name}
                      >
                        {color === swatch.color && <Check size={12} color={swatch.color === '#f8fafc' ? '#000' : '#fff'} />}
                      </button>
                    ))}
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="custom-color-picker"
                      title="Custom Hex Color"
                    />
                  </div>
                </div>
              </div>

              {/* Right Column: Live Object Preview Card */}
              <div className="custom-preview-card">
                <div className="preview-header">
                  <Eye size={13} className="icon-cyan" />
                  <span>3D Preview</span>
                </div>
                <div className="preview-visual-box">
                  <div
                    className="preview-avatar"
                    style={{
                      backgroundColor: color,
                      boxShadow: `0 0 16px ${color}44`
                    }}
                  >
                    {shape === 'mug' && <Coffee size={28} color="#fff" />}
                    {shape === 'apple' && <span style={{ fontSize: '26px' }}>🍎</span>}
                    {shape === 'glass' && <Wine size={28} color="#fff" />}
                    {shape === 'box' && <Box size={28} color="#fff" />}
                    {shape === 'cylinder' && <CylinderIcon size={28} color="#fff" />}
                    {shape === 'sphere' && <Circle size={28} color="#fff" />}
                  </div>
                  <div className="preview-title">{name || 'Unnamed Object'}</div>
                  <div className="preview-meta">
                    <span className="badge-shape">{shape.toUpperCase()}</span>
                    <span className="badge-zone">{zone.toUpperCase()} ZONE</span>
                  </div>
                </div>
                <p className="preview-tip">
                  Ready to be perceived by camera & picked by gripper.
                </p>
              </div>
            </div>

            {/* Submit Bar */}
            <div className="modal-actions-row">
              <button type="button" className="btn-modal-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-modal-primary">
                <Plus size={16} />
                <span>Spawn on Tabletop</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
