import React, { useEffect, useRef, useState } from 'react';
import { PaintBucket, Brush, CircleDashed, Spline, SquareSquare, Shapes, Save, SquarePlus, Copy, Trash2 } from 'lucide-react';
import { WORK_PATH_ID } from '../engine/paths.js';
import { PathThumb } from './PenOverlay.jsx';

// Photoshop-style Paths panel.
// Props: { paths: [{id, name, path}], workPath: Path|null, activeId (WORK_PATH_ID = 'work' for the Work Path),
//   docW?, docH? (thumbnail framing; defaults to each path's bounds),
//   onSelect(id), onRename(id, name), onDelete(id), onSaveWorkPath(), onNew(), onDuplicate(id), onFill(id),
//   onStroke(id), onLoadAsSelection(id), onMakeWorkPathFromSelection(), onMakeVectorMask(id), onMakeShapeLayer(id) }
// Only buttons whose handler is given are rendered. Double-click a saved path to rename it; double-click the
// Work Path to save it. Ctrl/Cmd-click a thumbnail loads the path as a selection (when onLoadAsSelection is given).
export default function PathsPanel({ paths = [], workPath = null, activeId = null, docW, docH, onSelect, onRename, onDelete, onSaveWorkPath, onNew, onDuplicate, onFill, onStroke, onLoadAsSelection, onMakeWorkPathFromSelection, onMakeVectorMask, onMakeShapeLayer }) {
  const [editing, setEditing] = useState(null);
  const [draftName, setDraftName] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const rows = [...(workPath ? [{ id: WORK_PATH_ID, name: 'Work Path', path: workPath, work: true }] : []), ...paths];
  const active = rows.find(r => r.id === activeId) || null;
  const startRename = row => { if (!onRename || row.work) return; setEditing(row.id); setDraftName(row.name); };
  const endRename = save => {
    if (save && editing) { const n = draftName.trim(); const row = rows.find(r => r.id === editing); if (n && row && n !== row.name) onRename(editing, n); }
    setEditing(null);
  };
  const pick = (e, row) => {
    if ((e.ctrlKey || e.metaKey) && onLoadAsSelection) { onLoadAsSelection(row.id); return; }
    onSelect?.(row.id);
  };
  const btn = (label, Icon, handler, needsTarget = true, title = label) => handler && (
    <button type="button" aria-label={label} title={title} disabled={needsTarget && !active} onClick={() => (needsTarget ? handler(active.id) : handler())}><Icon size={15} /></button>
  );

  return <div className="pathsPanel">
    <ul className="pathsList" role="listbox" aria-label="Paths">
      {!rows.length && <li className="pathsEmpty hint" role="presentation">No paths. Draw with the Pen tool to create a Work Path.</li>}
      {rows.map(row => {
        const on = row.id === activeId;
        return <li key={row.id} role="option" aria-selected={on} aria-label={row.name} tabIndex={0} className={'pathRow' + (on ? ' selected' : '') + (row.work ? ' work' : '')}
          onClick={e => pick(e, row)}
          onDoubleClick={() => (row.work ? onSaveWorkPath?.() : startRename(row))}
          onKeyDown={e => {
            if (editing === row.id) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(row.id); }
            else if (e.key === 'F2') { e.preventDefault(); startRename(row); }
          }}>
          <PathThumb path={row.path} docW={docW} docH={docH} size={34} />
          {editing === row.id
            ? <input ref={inputRef} aria-label="Path name" value={draftName} onChange={e => setDraftName(e.target.value)} onClick={e => e.stopPropagation()}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') endRename(true); else if (e.key === 'Escape') endRename(false); }} onBlur={() => endRename(true)} />
            : <span className="pathName">{row.name}</span>}
        </li>;
      })}
    </ul>
    <footer className="pathsFooter" role="toolbar" aria-label="Path actions">
      {btn('Fill path with foreground color', PaintBucket, onFill)}
      {btn('Stroke path with brush', Brush, onStroke)}
      {btn('Load path as a selection', CircleDashed, onLoadAsSelection)}
      {btn('Make work path from selection', Spline, onMakeWorkPathFromSelection, false)}
      {btn('Add vector mask', SquareSquare, onMakeVectorMask)}
      {btn('Make shape layer from path', Shapes, onMakeShapeLayer)}
      {onSaveWorkPath && active?.work && <button type="button" aria-label="Save work path" title="Save work path" onClick={() => onSaveWorkPath()}><Save size={15} /></button>}
      {btn('Create new path', SquarePlus, onNew, false)}
      {btn('Duplicate path', Copy, onDuplicate)}
      {btn('Delete path', Trash2, onDelete)}
    </footer>
  </div>;
}
