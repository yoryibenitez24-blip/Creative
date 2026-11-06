import React from 'react';

// History panel: every state the session can reach with undo/redo. Clicking a state jumps there;
// states after the current one stay available (greyed) until a new edit replaces them.
export default function HistoryPanel({ states, current, labelOf, onJump }) {
  return <div className="historyPanel" role="listbox" aria-label="History">
    {states.map((s, i) => <button key={i} role="option" aria-selected={i === current} className={'historyItem' + (i === current ? ' current' : '') + (i > current ? ' future' : '')} onClick={() => onJump(i)}>
      <span className="historyIndex">{i}</span>{i === 0 ? 'Open' : labelOf(s) || 'Edit'}
    </button>)}
    <p className="hint">{states.length - 1} step{states.length === 2 ? '' : 's'} · up to 80 kept this session</p>
  </div>;
}
