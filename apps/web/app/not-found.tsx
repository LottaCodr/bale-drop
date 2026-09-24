import Link from "next/link";
import { Compass, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CategoryPills } from "@/components/commerce";

/**
 * 404 with a way forward instead of a dead end (design principle #6: "zero dead
 * ends"). Also shown when a listing id no longer resolves — for example a
 * vendor paused it after the buyer bookmarked the URL.
 */
export default function NotFound() {
  return (
    <div className="container max-w-2xl py-16">
      <Card className="p-8 text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <PackageSearch className="h-8 w-8" />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">We couldn&apos;t find that page</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The listing may have sold out, been paused by the vendor, or the link is wrong. Live splits and verified
          shops are still one tap away.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/search">
              <Compass /> Browse listings
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/search?kind=bale">Live bale splits</Link>
          </Button>
        </div>
      </Card>
      <div className="mt-6">
        <p className="mb-3 text-center text-sm font-semibold">Shop by category</p>
        <CategoryPills />
      </div>
    </div>
  );
}
