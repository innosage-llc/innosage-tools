'use client';

import React from 'react';
import type { SceneNode } from '../../lib/visual-remix';

export type PreviewControlsProps = {
  nodes: SceneNode[];
  node?: SceneNode;
  selected: string;
  ready: boolean;
  pending: boolean;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  hasCandidate: boolean;
  exportable: boolean;
  motionBusy: boolean;
  motionReady: boolean;
  onSelect: (id: string) => void;
  onChange: (patch: Partial<SceneNode>) => void;
  onBackground: (value: string) => void;
  background: string;
  onUndo: () => void;
  onRedo: () => void;
  onApply: () => void;
  onCancel: () => void;
  onAddText: () => void;
  onRemove: () => void;
  onMove: (direction: number) => void;
  onExportPNG: () => void;
  onSaveProject: () => void;
  onCaptions: () => void;
  onExportMotion: () => void;
  onCancelMotion: () => void;
  onDownloadMotion: () => void;
  onDiscardDraft: () => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
};

export function PreviewControls({
  nodes,
  node,
  selected,
  ready,
  pending,
  revision,
  canUndo,
  canRedo,
  hasCandidate,
  exportable,
  motionBusy,
  motionReady,
  onSelect,
  onChange,
  onBackground,
  background,
  onUndo,
  onRedo,
  onApply,
  onCancel,
  onAddText,
  onRemove,
  onMove,
  onExportPNG,
  onSaveProject,
  onCaptions,
  onExportMotion,
  onCancelMotion,
  onDownloadMotion,
  onDiscardDraft,
  onGestureStart,
  onGestureEnd,
}: PreviewControlsProps) {
  const handleNumberKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
      onGestureStart();
    }
  };

  const handleNumberKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) {
      onGestureEnd();
    }
  };

  const numberGestureProps = {
    onPointerDown: () => onGestureStart(),
    onPointerUp: () => onGestureEnd(),
    onPointerCancel: () => onGestureEnd(),
    onKeyDown: handleNumberKeyDown,
    onKeyUp: handleNumberKeyUp,
  };

  const exportDisabled = !exportable || pending || !ready;
  const applyDisabled = pending || !ready;

  return (
    <section
      data-testid="preview-controls"
      className="p-3 bg-white border border-gray-200 rounded-xl space-y-3 w-full max-w-full text-gray-900 text-xs box-border overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-2">
        <span className="font-semibold text-gray-800 text-xs">Editor Controls</span>
        <span className="text-gray-500 text-[11px]">Revision {revision}</span>
      </div>

      <div className="text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5 space-y-1">
        <p>Local edits apply automatically. Remote candidate proposals require explicit Apply.</p>
        {pending && (
          <p className="text-amber-800 font-medium">
            Applying local draft... Exports and Apply are disabled while applying, but you can continue correcting inputs.
          </p>
        )}
      </div>

      {/* Main Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo"
          className="px-2.5 py-1.5 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="Redo"
          className="px-2.5 py-1.5 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Redo
        </button>
        <button
          type="button"
          onClick={onExportPNG}
          disabled={exportDisabled}
          className="px-2.5 py-1.5 text-xs font-medium rounded border border-gray-900 bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Download PNG
        </button>
        <button
          type="button"
          onClick={onSaveProject}
          disabled={!ready || pending}
          className="px-2.5 py-1.5 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save project
        </button>
        {hasCandidate && (
          <>
            <button
              type="button"
              onClick={onApply}
              disabled={applyDisabled}
              className="px-2.5 py-1.5 text-xs font-medium rounded border border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply candidate
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={!ready || pending}
              className="px-2.5 py-1.5 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel candidate
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onDiscardDraft}
          disabled={!pending}
          className="px-2.5 py-1.5 text-xs font-medium rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Discard local draft
        </button>
      </div>

      {/* Primary Form Fields */}
      <fieldset disabled={!ready} className="space-y-2.5 pt-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label htmlFor="preview-layer-select" className="block text-xs font-medium text-gray-700 mb-1">
              Layer
            </label>
            <select
              id="preview-layer-select"
              aria-label="Layer"
              value={selected}
              onChange={(e) => onSelect(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Choose a layer</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="preview-background-input" className="block text-xs font-medium text-gray-700 mb-1">
              Background
            </label>
            <input
              id="preview-background-input"
              aria-label="Background"
              type="text"
              value={background}
              onChange={(e) => onBackground(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {node && (
          <div className="space-y-2.5 border-t border-gray-100 pt-2">
            {node.type === 'text' && (
              <div>
                <label htmlFor="preview-text-content" className="block text-xs font-medium text-gray-700 mb-1">
                  Text content
                </label>
                <textarea
                  id="preview-text-content"
                  aria-label="Text content"
                  value={node.text}
                  rows={3}
                  maxLength={20_000}
                  onChange={(e) => onChange({ text: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs border border-gray-300 rounded-md bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label htmlFor="preview-node-x" className="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Node x
                </label>
                <input
                  id="preview-node-x"
                  aria-label="Node x"
                  type="number"
                  value={Number.isFinite(node.x) ? node.x : ''}
                  onChange={(e) => {
                    const val = e.target.valueAsNumber;
                    if (!Number.isNaN(val)) onChange({ x: val });
                  }}
                  {...numberGestureProps}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="preview-node-y" className="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Node y
                </label>
                <input
                  id="preview-node-y"
                  aria-label="Node y"
                  type="number"
                  value={Number.isFinite(node.y) ? node.y : ''}
                  onChange={(e) => {
                    const val = e.target.valueAsNumber;
                    if (!Number.isNaN(val)) onChange({ y: val });
                  }}
                  {...numberGestureProps}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="preview-node-width" className="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Node width
                </label>
                <input
                  id="preview-node-width"
                  aria-label="Node width"
                  type="number"
                  value={Number.isFinite(node.width) ? node.width : ''}
                  onChange={(e) => {
                    const val = e.target.valueAsNumber;
                    if (!Number.isNaN(val)) onChange({ width: val });
                  }}
                  {...numberGestureProps}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="preview-node-height" className="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Node height
                </label>
                <input
                  id="preview-node-height"
                  aria-label="Node height"
                  type="number"
                  value={Number.isFinite(node.height) ? node.height : ''}
                  onChange={(e) => {
                    const val = e.target.valueAsNumber;
                    if (!Number.isNaN(val)) onChange({ height: val });
                  }}
                  {...numberGestureProps}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {node.type === 'text' && (
              <div className="w-1/2 pr-1">
                <label htmlFor="preview-font-size" className="block text-[11px] font-medium text-gray-600 mb-0.5">
                  Font size
                </label>
                <input
                  id="preview-font-size"
                  aria-label="Font size"
                  type="number"
                  value={Number.isFinite(node.fontSize) ? node.fontSize : ''}
                  onChange={(e) => {
                    const val = e.target.valueAsNumber;
                    if (!Number.isNaN(val)) onChange({ fontSize: val });
                  }}
                  {...numberGestureProps}
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </div>
        )}
      </fieldset>

      {/* Compact Details for Secondary Actions */}
      <details open className="border-t border-gray-100 pt-2 text-xs">
        <summary className="cursor-pointer font-medium text-gray-700 py-1">Layer order &amp; exports</summary>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            onClick={onAddText}
            disabled={!ready || nodes.length >= 100}
            className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Add text block
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={!ready || !selected}
            className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Remove selected
          </button>
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={!ready || !selected}
            className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Move backward
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={!ready || !selected}
            className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Move forward
          </button>
          <button
            type="button"
            onClick={onCaptions}
            disabled={!ready || pending}
            className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Download captions
          </button>
          {motionBusy ? (
            <button
              type="button"
              onClick={onCancelMotion}
              disabled={!ready || pending}
              className="px-2.5 py-1 text-xs font-medium rounded border border-red-300 bg-red-50 text-red-800 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel motion export
            </button>
          ) : (
            <button
              type="button"
              onClick={onExportMotion}
              disabled={exportDisabled || motionBusy}
              className="px-2.5 py-1 text-xs font-medium rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Export MP4
            </button>
          )}
          {motionReady && (
            <button
              type="button"
              onClick={onDownloadMotion}
              disabled={!ready || pending}
              className="px-2.5 py-1 text-xs font-medium rounded border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Download MP4
            </button>
          )}
        </div>
      </details>
    </section>
  );
}
