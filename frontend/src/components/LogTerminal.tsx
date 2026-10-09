import React, { useState, useRef, useEffect } from 'react';
import type { RosLog } from '../types';
import { Terminal, Trash2, ArrowDownToLine, Search } from 'lucide-react';

interface LogTerminalProps {
  logs: RosLog[];
  onClearLogs: () => void;
}

export const LogTerminal: React.FC<LogTerminalProps> = ({ logs, onClearLogs }) => {
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const filteredLogs = logs.filter((log) => {
    if (filterLevel === 'INFO' && log.levelName !== 'INFO') return false;
    if (filterLevel === 'WARN' && log.levelName !== 'WARN') return false;
    if (filterLevel === 'ERROR' && log.levelName !== 'ERROR' && log.levelName !== 'FATAL') return false;
    if (searchTerm) {
      const text = `${log.nodeName} ${log.message}`.toLowerCase();
      return text.includes(searchTerm.toLowerCase());
    }
    return true;
  });

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredLogs, autoScroll]);

  return (
    <div className="terminal-container">
      {/* Terminal Toolbar */}
      <div className="terminal-toolbar">
        <div className="toolbar-left">
          <Terminal size={16} className="terminal-icon" />
          <span className="terminal-title">ROS 2 Log Stream (/rosout)</span>
          <span className="log-count-badge">{filteredLogs.length} logs</span>
        </div>

        <div className="toolbar-right">
          {/* Filter Pills */}
          <div className="filter-pill-group">
            <button
              className={`filter-btn ${filterLevel === 'ALL' ? 'active' : ''}`}
              onClick={() => setFilterLevel('ALL')}
            >
              ALL
            </button>
            <button
              className={`filter-btn btn-info ${filterLevel === 'INFO' ? 'active' : ''}`}
              onClick={() => setFilterLevel('INFO')}
            >
              INFO
            </button>
            <button
              className={`filter-btn btn-warn ${filterLevel === 'WARN' ? 'active' : ''}`}
              onClick={() => setFilterLevel('WARN')}
            >
              WARN
            </button>
            <button
              className={`filter-btn btn-error ${filterLevel === 'ERROR' ? 'active' : ''}`}
              onClick={() => setFilterLevel('ERROR')}
            >
              ERROR
            </button>
          </div>

          {/* Search Field */}
          <div className="terminal-search-box">
            <Search size={13} className="search-icon" />
            <input
              type="text"
              placeholder="Filter node or msg..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Autoscroll Toggle */}
          <button
            className={`tool-action-btn ${autoScroll ? 'active' : ''}`}
            title="Auto-scroll to bottom"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            <ArrowDownToLine size={14} />
          </button>

          {/* Clear Button */}
          <button
            className="tool-action-btn danger"
            title="Clear logs"
            onClick={onClearLogs}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div className="terminal-viewport">
        {filteredLogs.length === 0 ? (
          <div className="terminal-empty">
            <span>No log messages received yet. Send a command or wait for ROS nodes.</span>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isError = log.levelName === 'ERROR' || log.levelName === 'FATAL';
            const isWarn = log.levelName === 'WARN';

            return (
              <div
                key={log.id}
                className={`terminal-line ${isError ? 'log-error' : isWarn ? 'log-warn' : ''}`}
              >
                <span className="log-time">[{log.timestamp}]</span>
                <span className={`log-level-badge level-${log.levelName.toLowerCase()}`}>
                  {log.levelName}
                </span>
                <span className="log-node">[{log.nodeName}]</span>
                <span className="log-msg">{log.message}</span>
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
};

