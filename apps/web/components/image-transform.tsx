"use client";

export function ImageTransformUrl({ path, width = 400 }: { path: string; width?: number }) {
  const url = `/api/storage/${path}?w=${width}&q=80`;
  return <img src={url} alt="" loading="lazy" className="rounded-lg" />;
}
