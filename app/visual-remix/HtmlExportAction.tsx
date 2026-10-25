'use client';

interface HtmlExportActionProps {
  disabled: boolean;
  onExport: () => void;
}

export function HtmlExportAction({ disabled, onExport }: HtmlExportActionProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onExport}
      title="Download offline HTML with separate layers. Stitch native layer editing has not been verified."
      className="rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
    >
      Export HTML
    </button>
  );
}
