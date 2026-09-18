import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebase';
import type { ChantierDocument } from '../types';

export async function uploadChantierDocument(
  chantierId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ChantierDocument> {
  const id = crypto.randomUUID();
  const storagePath = `chantiers/${chantierId}/docs/${id}-${file.name}`;
  const storageRef = ref(storage, storagePath);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType: file.type });
    task.on(
      'state_changed',
      snap => onProgress?.(snap.bytesTransferred / snap.totalBytes * 100),
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve({
          id,
          name: file.name,
          storagePath,
          url,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          uploadedAt: new Date().toISOString(),
        });
      },
    );
  });
}

export async function deleteChantierDocument(d: ChantierDocument): Promise<void> {
  try {
    await deleteObject(ref(storage, d.storagePath));
  } catch {
    // File may already be gone — ignore
  }
}
