import React, { useState } from 'react';
import {
  X,
  Sparkles,
  Search,
  Bot,
  Coffee,
  Package,
  Repeat,
  Scan,
  ShieldCheck,
  Play,
  ArrowRight
} from 'lucide-react';

export interface CommandItem {
  id: string;
  command: string;
  category: 'assistance' | 'manipulation' | 'loops' | 'perception' | 'safety';
  categoryLabel: string;
  badge: string;
  badgeType: 'cyan' | 'emerald' | 'amber' | 'purple' | 'red';
  description: string;
  flow: string;
}

const COMMAND_CATALOGUE: CommandItem[] = [
  // 1. Human Assistance & Handover
  {
    id: 'cmd-want-coffee',
    command: 'I want my coffee',
    category: 'assistance',
    categoryLabel: 'Human Assistance & Drinks',
    badge: 'SayCan Handover',
    badgeType: 'emerald',
    description: 'Understands human need for coffee, performs active camera sweep to locate coffee mug, grasps it and delivers to user handover zone.',
    flow: 'Search Mug -> YOLO Reticle Lock -> Dynamic IK -> Grasp -> Transfer to User -> Release'
  },
  {
    id: 'cmd-thirsty',
    command: 'I am thirsty',
    category: 'assistance',
    categoryLabel: 'Human Assistance & Drinks',
    badge: 'SayCan Handover',
    badgeType: 'emerald',
    description: 'Grounds thirst into visual search for water glass, retrieves it from the table and delivers directly to user.',
    flow: 'Perception Scan -> Align End-Effector -> Grip Water -> Handover Pose'
  },
  {
    id: 'cmd-bring-coffee',
    command: 'Bring me the coffee mug',
    category: 'assistance',
    categoryLabel: 'Human Assistance & Drinks',
    badge: 'Assistive Fetch',
    badgeType: 'cyan',
    description: 'Direct fetch instruction targeting coffee mug, delivering safely to the operator.',
    flow: 'Active Vision -> Approach -> Pick -> Transfer to User'
  },
  {
    id: 'cmd-play-tennis',
    command: 'I want to play tennis',
    category: 'assistance',
    categoryLabel: 'Human Assistance & Activities',
    badge: 'Sports Handover',
    badgeType: 'emerald',
    description: 'Infers tennis equipment requirement from natural language, visually detects tennis ball on table (or materializes it), and executes assistive handover.',
    flow: 'Activity Inference -> Camera Scan -> 6-DOF IK -> Grip Tennis Ball -> User Handover'
  },
  {
    id: 'cmd-pass-tennis-ball',
    command: 'Pass me the tennis ball',
    category: 'assistance',
    categoryLabel: 'Human Assistance & Activities',
    badge: 'Assistive Fetch',
    badgeType: 'cyan',
    description: 'Direct fetch instruction targeting the tennis ball with real-time collision-free delivery to operator.',
    flow: 'Vision Reticle -> Align Gripper -> Grasp Ball -> Transfer to User'
  },
  {
    id: 'cmd-hungry-apple',
    command: 'I am hungry, give me an apple',
    category: 'assistance',
    categoryLabel: 'Human Assistance & Activities',
    badge: 'Snack Handover',
    badgeType: 'emerald',
    description: 'Grounds physiological hunger into visual search for fresh apple/fruit and performs smooth assistive handover.',
    flow: 'Active Vision -> Approach Apple -> Grasp -> Handover Pose -> Release'
  },
  {
    id: 'cmd-hand-drink',
    command: 'Hand me the water glass',
    category: 'assistance',
    categoryLabel: 'Human Assistance & Drinks',
    badge: 'Assistive Fetch',
    badgeType: 'cyan',
    description: 'Carefully lifts the water glass and extends it to the user handover position.',
    flow: 'Visual Acquire -> Gripper Align -> Grasp -> Handover'
  },

  // 2. Object Grasp & Manipulation
  {
    id: 'cmd-pick-cube',
    command: 'Pick up the red cube',
    category: 'manipulation',
    categoryLabel: 'Object Manipulation',
    badge: 'Dynamic Grasp',
    badgeType: 'cyan',
    description: 'Performs camera sweep to detect red cube at any coordinates, solves 6-DOF closed-form IK, descends and lifts 18cm above table.',
    flow: 'Visual Search -> 6-DOF IK Solution -> Open Gripper -> Descend -> Grip -> Lift'
  },
  {
    id: 'cmd-pick-cylinder',
    command: 'Grab the blue cylinder',
    category: 'manipulation',
    categoryLabel: 'Object Manipulation',
    badge: 'Dynamic Grasp',
    badgeType: 'cyan',
    description: 'Locates blue cylinder wherever dragged on table, computes azimuth & wrist pitch, and firmly grasps.',
    flow: 'YOLO Scan -> Radial Distance IK -> Grasp Cylinder -> Lift'
  },
  {
    id: 'cmd-pick-sphere',
    command: 'Pick up the green sphere',
    category: 'manipulation',
    categoryLabel: 'Object Manipulation',
    badge: 'Dynamic Grasp',
    badgeType: 'cyan',
    description: 'Visual acquisition and precision spherical grip on green sphere item.',
    flow: 'Visual Search -> Approach -> Grip -> Lift 18cm'
  },
  {
    id: 'cmd-place-tray',
    command: 'Place the red cube into the tray',
    category: 'manipulation',
    categoryLabel: 'Object Manipulation',
    badge: 'Pick & Place',
    badgeType: 'purple',
    description: 'Transfers grasped object smoothly across tabletop into the designated storage tray.',
    flow: 'Search Cube -> Grasp -> Approach Storage Tray (0.42, 0.46) -> Place & Release'
  },

  // 3. Tabletop Loops & Autonomy
  {
    id: 'cmd-clean-table',
    command: 'Clean up the table',
    category: 'loops',
    categoryLabel: 'Tabletop Loops & Autonomy',
    badge: 'Full Workspace Loop',
    badgeType: 'purple',
    description: 'Generalized robotic loop: scans every object on the table sequentially and transfers all items into storage tray.',
    flow: 'For Each Object: Visual Search -> Dynamic IK -> Grasp -> Deposit in Tray'
  },
  {
    id: 'cmd-rerack',
    command: 'Re-rack the table',
    category: 'loops',
    categoryLabel: 'Tabletop Loops & Autonomy',
    badge: 'Reverse Loop',
    badgeType: 'purple',
    description: 'Retrieves all stored items from the storage tray and distributes them back onto tabletop staging coordinates.',
    flow: 'Tray Fetch -> Transfer -> Deposit on Table Station'
  },
  {
    id: 'cmd-loop-twice',
    command: 'Pick and place twice',
    category: 'loops',
    categoryLabel: 'Tabletop Loops & Autonomy',
    badge: 'Count-Based Loop',
    badgeType: 'purple',
    description: 'Executes a multi-iteration robotic pick-and-place loop with counter telemetry.',
    flow: 'Loop Iteration 1 -> Deposit -> Loop Iteration 2 -> Deposit -> Home'
  },
  {
    id: 'cmd-scatter',
    command: 'Scatter objects anywhere on table',
    category: 'loops',
    categoryLabel: 'Tabletop Loops & Autonomy',
    badge: 'Workspace Shuffle',
    badgeType: 'amber',
    description: 'Randomizes object coordinates across the tabletop workspace to challenge active perception and dynamic IK.',
    flow: 'Scatter Simulation -> Retract Arm -> Standby for Perception'
  },

  // 4. Perception & Active Search
  {
    id: 'cmd-search-coffee',
    command: 'Search for the coffee mug',
    category: 'perception',
    categoryLabel: 'Perception & Active Search',
    badge: 'Active Vision Scan',
    badgeType: 'cyan',
    description: 'Elevates arm overhead, sweeps RGB-D camera across tabletop, and locks green YOLO reticle on detected coffee mug.',
    flow: 'Elevated Scan Pose -> Camera Sweep -> YOLO Reticle Lock (99.4%)'
  },
  {
    id: 'cmd-search-cube',
    command: 'Search for the red cube',
    category: 'perception',
    categoryLabel: 'Perception & Active Search',
    badge: 'Active Vision Scan',
    badgeType: 'cyan',
    description: 'Visually acquires target without moving blindly or relying on preset coordinates.',
    flow: 'Overhead Scan -> Camera Tilt -> Bounding Reticle Lock'
  },
  {
    id: 'cmd-scan-workspace',
    command: 'Scan the tabletop workspace',
    category: 'perception',
    categoryLabel: 'Perception & Active Search',
    badge: 'Full Table Scan',
    badgeType: 'cyan',
    description: 'Comprehensive active vision scan across table to register spatial coordinates of all items.',
    flow: 'Panoramic Overhead Sweep -> Multi-Object Coordinates Register'
  },

  // 5. Safety & Transit Guardrails
  {
    id: 'cmd-go-home',
    command: 'Move to the home position',
    category: 'safety',
    categoryLabel: 'Safety & Transit',
    badge: 'Transit Pose',
    badgeType: 'cyan',
    description: 'Smoothly interpolates all 6 arm joints back to zero home transit position.',
    flow: 'Trajectory Ease-In-Out -> Zero Joint Angles [0, 0, 0, 0, 0, 0]'
  },
  {
    id: 'cmd-open-gripper',
    command: 'Open gripper fingers',
    category: 'safety',
    categoryLabel: 'Safety & Transit',
    badge: 'Actuator Control',
    badgeType: 'cyan',
    description: 'Commands gripper prismatic joints to 80mm full opening stroke.',
    flow: 'Gripper Actuator -> Stroke 80mm'
  },
  {
    id: 'cmd-close-gripper',
    command: 'Close gripper',
    category: 'safety',
    categoryLabel: 'Safety & Transit',
    badge: 'Actuator Control',
    badgeType: 'cyan',
    description: 'Fingers close firmly with compliance.',
    flow: 'Gripper Actuator -> Stroke 15mm'
  },
  {
    id: 'cmd-guardrail-mored',
    command: 'I am mored',
    category: 'safety',
    categoryLabel: 'Safety & Transit',
    badge: 'SayCan Guardrail',
    badgeType: 'red',
    description: 'Demonstrates SayCan safety guardrail: non-actionable input scores below 0.30 threshold and is safely rejected without unintended motion.',
    flow: 'NLU Parse (conf 0.12) -> SayCan Guardrail Rejection -> Arm Remains Idle'
  },
  {
    id: 'cmd-guardrail-joke',
    command: 'Tell me a funny joke',
    category: 'safety',
    categoryLabel: 'Safety & Transit',
    badge: 'SayCan Guardrail',
    badgeType: 'red',
    description: 'Conversational input evaluated for physical affordance. Safely blocked to protect hardware.',
    flow: 'NLU Unknown -> Combined Affordance < 0.30 -> Guardrail Block'
  }
];

interface CommandCatalogueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCommand: (cmd: string) => void;
  isBusy: boolean;
}

export const CommandCatalogueModal: React.FC<CommandCatalogueModalProps> = ({
  isOpen,
  onClose,
  onSelectCommand,
  isBusy
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');

  if (!isOpen) return null;

  const categories = [
    { id: 'all', label: 'All Commands', icon: Sparkles },
    { id: 'assistance', label: 'Human Needs & Drinks', icon: Coffee },
    { id: 'manipulation', label: 'Object Manipulation', icon: Package },
    { id: 'loops', label: 'Tabletop Loops', icon: Repeat },
    { id: 'perception', label: 'Perception & Search', icon: Scan },
    { id: 'safety', label: 'Safety & Guardrails', icon: ShieldCheck }
  ];

  const filteredCommands = COMMAND_CATALOGUE.filter((item) => {
    const matchesCat = activeCategory === 'all' || item.category === activeCategory;
    const q = searchFilter.toLowerCase().trim();
    const matchesSearch =
      !q ||
      item.command.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.categoryLabel.toLowerCase().includes(q) ||
      item.badge.toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  const handleExecute = (cmd: string) => {
    onSelectCommand(cmd);
    onClose();
  };

  return (
    <div className="catalogue-modal-backdrop" onClick={onClose}>
      <div className="catalogue-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="catalogue-header">
          <div className="catalogue-title-wrap">
            <div className="catalogue-icon-wrap">
              <Bot size={22} className="icon-cyan" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 className="catalogue-title">NORA Command Catalogue</h3>
                <span className="catalogue-badge-count">{COMMAND_CATALOGUE.length} Commands</span>
              </div>
              <p className="catalogue-subtitle">
                Ground natural English instructions into physically verified robotic skills
              </p>
            </div>
          </div>
          <button className="btn-modal-close" onClick={onClose} title="Close catalogue">
            <X size={18} />
          </button>
        </div>

        {/* Search Bar & Category Navigation */}
        <div className="catalogue-controls-row">
          <div className="catalogue-search-box">
            <Search size={15} className="search-icon" />
            <input
              type="text"
              placeholder="Search catalogue (e.g. coffee, clean, pick, handover, guardrail)..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              autoFocus
            />
            {searchFilter && (
              <button
                className="btn-search-clear"
                onClick={() => setSearchFilter('')}
                title="Clear filter"
              >
                ×
              </button>
            )}
          </div>

          <div className="catalogue-category-tabs">
            {categories.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  className={`cat-tab-btn ${activeCategory === cat.id ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <Icon size={13} />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Commands Grid / List */}
        <div className="catalogue-cards-container">
          {filteredCommands.length === 0 ? (
            <div className="catalogue-empty-state">
              <Bot size={36} className="icon-muted" />
              <span>No commands found matching "{searchFilter}"</span>
            </div>
          ) : (
            filteredCommands.map((item) => (
              <div key={item.id} className="catalogue-item-card">
                <div className="card-top-row">
                  <div className="card-command-badge-group">
                    <span className="card-command-text">"{item.command}"</span>
                    <span className={`pill-badge pill-${item.badgeType}`}>
                      {item.badge}
                    </span>
                  </div>

                  <button
                    className="btn-card-execute"
                    onClick={() => handleExecute(item.command)}
                    title={isBusy ? 'Interrupt current task and run this command now' : 'Execute this command now'}
                  >
                    <Play size={12} />
                    <span>Run Command</span>
                  </button>
                </div>

                <p className="card-description">{item.description}</p>

                <div className="card-flow-row">
                  <span className="flow-label">
                    <ArrowRight size={11} className="icon-cyan" /> Execution Pipeline:
                  </span>
                  <span className="flow-text">{item.flow}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="catalogue-footer">
          <div className="catalogue-footer-tip">
            <Sparkles size={13} className="icon-cyan" />
            <span>
              Tip: You can also type custom natural English phrases directly into the command bar!
            </span>
          </div>
          <button className="btn-modal-cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
