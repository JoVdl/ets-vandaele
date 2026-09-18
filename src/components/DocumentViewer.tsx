import { X, ExternalLink, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChantierDocument } from '../types';

interface Props {
  doc: ChantierDocument;
  onClose: () => void;
}

function embedUrl(doc: ChantierDocument): string {
  // Google Drive: /view → /preview (native Drive viewer, works for PDF + Office)
  const driveMatch = doc.url.match(/\/file\/d\/([^/]+)\//);
  if (driveMatch) return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;

  // PDF from Firebase Storage: embed directly
  if (doc.contentType === 'application/pdf') return doc.url;

  // Office / other: Google Docs viewer
  return `https://docs.google.com/viewer?url=${encodeURIComponent(doc.url)}&embedded=true`;
}

export default function DocumentViewer({ doc, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const src = embedUrl(doc);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex flex-col bg-slate-900">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800 flex-shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors flex-shrink-0">
          <X size={18}/>
        </button>
        <p className="flex-1 min-w-0 text-sm font-medium text-white truncate">{doc.name}</p>
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors flex-shrink-0"
          title="Ouvrir dans un nouvel onglet">
          <ExternalLink size={16}/>
        </a>
      </div>

      {/* Viewer */}
      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 size={28} className="animate-spin"/>
            <p className="text-sm">Chargement…</p>
          </div>
        )}
        <iframe
          src={src}
          title={doc.name}
          className="w-full h-full border-0"
          onLoad={() => setLoading(false)}
          allow="autoplay"
        />
      </div>
    </div>,
    document.body,
  );
}
