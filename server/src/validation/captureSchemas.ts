import { z } from 'zod';

export const capturePreviewBodySchema = z.strictObject({
  url: z.string()
    .trim()
    .min(1)
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'must be an absolute HTTP(S) URL'),
});

export type CapturePreviewBody = z.infer<typeof capturePreviewBodySchema>;
