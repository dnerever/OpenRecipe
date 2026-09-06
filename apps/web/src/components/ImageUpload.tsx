import { parseRecipe, serializeRecipe } from '@openrecipe/core';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, MAX_UPLOAD_BYTES, uploadImage } from '../lib/api.ts';

/**
 * Uploads a photo and writes it into the document.
 *
 * The insertion goes through `parseRecipe`/`serializeRecipe` rather than a
 * string splice, because the frontmatter is YAML and the one thing worse than
 * no photo is a document the editor can no longer read. That also means a
 * draft with a syntax error cannot take a photo — which is the right order to
 * fix things in anyway.
 */
export function ImageUpload({
  handle,
  slug,
  draft,
  onChange,
}: {
  handle: string;
  slug: string;
  draft: string;
  onChange: (next: string) => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (file: File) => uploadImage(handle, slug, file),
    onSuccess: (image) => {
      try {
        const doc = parseRecipe(draft);
        onChange(
          serializeRecipe({ ...doc, frontmatter: { ...doc.frontmatter, image: image.url } }),
        );
        setProblem(null);
      } catch {
        setProblem('The recipe has to parse before a photo can be added to it.');
      }
    },
    onError: (err) => setProblem(describeUploadError(err)),
  });

  return (
    <div className="image-upload">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > MAX_UPLOAD_BYTES) {
            setProblem('That photo is over 8 MB. Try a smaller one.');
            return;
          }
          setProblem(null);
          mutation.mutate(file);
        }}
      />
      <button
        type="button"
        className="secondary"
        disabled={mutation.isPending}
        onClick={() => input.current?.click()}
      >
        {mutation.isPending ? 'Uploading…' : 'Add a photo'}
      </button>
      <span className="hint">
        Up to 8 MB. Location and camera data are stripped before it is stored.
      </span>
      {problem && <p className="bad">{problem}</p>}
    </div>
  );
}

function describeUploadError(error: Error): string {
  if (!(error instanceof ApiError)) return error.message;
  switch (error.message) {
    case 'file_too_large':
      return 'That photo is over 8 MB. Try a smaller one.';
    case 'unsupported_type':
      return 'That file is not an image this can read — JPEG, PNG, WebP, AVIF or GIF.';
    case 'unreadable_image':
      return 'That file says it is an image but does not decode as one.';
    case 'storage_unavailable':
      return 'Image storage is not configured on this server.';
    default:
      return error.message;
  }
}
