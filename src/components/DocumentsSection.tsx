import { useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, Trash2, Loader2, ExternalLink, FileText, FileImage, FileSpreadsheet, File } from 'lucide-react';
import { updateDoc, doc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { uploadChantierDocument, deleteChantierDocument } from '../lib/storage';
import type { ChantierDocument } from '../types';
import DocumentViewer from './DocumentViewer';

interface Props {
  chantierId: string;
  documents: ChantierDocument[];
  readOnly?: boolean;
  onChange?: (docs: ChantierDocument[]) => void;
}

function DocIcon({ contentType }: { contentType: string }) {
  if (contentType.startsWith('image/'))
    return <FileImage size={14} className="text-purple-500 flex-shrink-0"/>;
  if (contentType === 'application/pdf')
    return <FileText size={14} className="text-red-500 flex-shrink-0"/>;
  if (contentType.includes('sheet') || contentType.includes('excel') || contentType.includes('csv'))
    return <FileSpreadsheet size={14} className="text-green-600 flex-shrink-0"/>;
  if (contentType.includes('word') || contentType.includes('document'))
    return <FileText size={14} className="text-blue-500 flex-shrink-0"/>;
  return <File size={14} className="text-slate-400 flex-shrink-0"/>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function DocumentsSection({ chantierId, documents, readOnly = false, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<ChantierDocument[]>(documents);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ChantierDocument | null>(null);

  useEffect(() => { setDocs(documents); }, [documents]);

  const update = (next: ChantierDocument[]) => {
    setDocs(next);
    onChange?.(next);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    if (file.size > 20 * 1024 * 1024) { setError('Fichier trop volumineux (max 20 Mo)'); return; }
    setError(null);
    setUploading(true);
    setUploadPct(0);
    try {
      const newDoc = await uploadChantierDocument(chantierId, file, pct => setUploadPct(pct));
      await updateDoc(doc(db, 'chantiers', chantierId), { documents: arrayUnion(newDoc) });
      update([...docs, newDoc]);
    } catch {
      setError("Échec de l'envoi. Vérifiez les règles Firebase Storage.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (d: ChantierDocument) => {
    if (!confirm(`Supprimer "${d.name}" ?`)) return;
    setDeleting(d.id);
    try {
      await deleteChantierDocument(d);
      await updateDoc(doc(db, 'chantiers', chantierId), { documents: arrayRemove(d) });
      update(docs.filter(x => x.id !== d.id));
    } catch {
      setError('Échec de la suppression.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide flex items-center gap-1">
          <Paperclip size={11}/> Documents ({docs.length})
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40 transition-colors">
            {uploading
              ? <><Loader2 size={11} className="animate-spin"/> {Math.round(uploadPct)}%</>
              : <><Upload size={11}/> Ajouter un fichier</>
            }
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={handleFile}
          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv,.zip"
        />
      </div>

      {error && (
        <p className="text-[11px] text-red-500 mb-2">{error}</p>
      )}

      {docs.length === 0 ? (
        <p className="text-[11px] text-slate-400 italic py-1">Aucun document joint</p>
      ) : (
        <div className="space-y-1">
          {docs.map(d => (
            <div
              key={d.id}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
              <DocIcon contentType={d.contentType}/>
              <button
                type="button"
                onClick={() => setViewing(d)}
                className="flex-1 min-w-0 text-left">
                <p className="text-xs font-medium text-slate-700 truncate hover:text-blue-600 transition-colors">{d.name}</p>
                <p className="text-[10px] text-slate-400">{formatSize(d.sizeBytes)}</p>
              </button>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 hover:text-blue-500 flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-all"
                title="Ouvrir dans un nouvel onglet">
                <ExternalLink size={13}/>
              </a>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleDelete(d)}
                  disabled={deleting === d.id}
                  className="text-slate-300 hover:text-red-500 flex-shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-40"
                  title="Supprimer">
                  {deleting === d.id
                    ? <Loader2 size={13} className="animate-spin"/>
                    : <Trash2 size={13}/>
                  }
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <DocumentViewer doc={viewing} onClose={() => setViewing(null)}/>
      )}
    </div>
  );
}
