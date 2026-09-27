import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** Public-facing fallback when a feature cannot safely be used. */
export function ServiceUnavailable({
  title = "This service is temporarily unavailable",
  description = "Please try again later.",
  homeLink = true,
}: {
  title?: string;
  description?: string;
  homeLink?: boolean;
}) {
  return (
    <div className="container max-w-xl py-12">
      <Card className="p-8 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {homeLink && <Button className="mt-5" asChild><Link href="/">Back to home</Link></Button>}
      </Card>
    </div>
  );
}
