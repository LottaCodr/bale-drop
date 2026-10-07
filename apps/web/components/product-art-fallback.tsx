import { ProductArt } from "@/components/commerce";

/**
 * Fixed-aspect product art for compact rails (no layout shift, no network).
 * Kept separate from `commerce.tsx` so client components can use it without
 * importing the whole commerce module graph.
 *
 * Pass `src` when the snapshot carries an uploaded photo: the rails then show
 * the real product, and the gradient stays as the no-image fallback (migration
 * 0022 makes images optional, so most seed rows have none).
 */
export function ProductArtFallback({
  hue,
  category,
  src,
  alt,
  className = "aspect-[4/3] w-full",
}: {
  hue: number;
  category: string;
  src?: string | null;
  alt?: string;
  className?: string;
}) {
  return (
    <ProductArt hue={hue} category={category} src={src} alt={alt} className={className} iconClassName="h-8 w-8" />
  );
}
