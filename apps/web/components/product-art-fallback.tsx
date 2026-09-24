import { ProductArt } from "@/components/commerce";

/**
 * Fixed-aspect product art for compact rails (no layout shift, no network).
 * Kept separate from `commerce.tsx` so client components can use it without
 * importing the whole commerce module graph.
 */
export function ProductArtFallback({
  hue,
  category,
  className = "aspect-[4/3] w-full",
}: {
  hue: number;
  category: string;
  className?: string;
}) {
  return <ProductArt hue={hue} category={category} className={className} iconClassName="h-8 w-8" />;
}
