import { Check, X } from "lucide-react";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Stars } from "@/components/ui/stars";
import { GradeBadge, ProductArt, SectionHeader } from "@/components/commerce";

/** Living design system — every primitive in one place. If it's not here, don't ship it. */

export default function DesignPage() {
  return (
    <div className="container max-w-5xl py-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Design system</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        shadcn primitives + Bale Drop tokens. Semantic colors only — no hardcoded hex in components.
      </p>

      {/* Tokens */}
      <div className="mt-8">
        <SectionHeader title="Color tokens" sub="Light / dark via CSS variables." />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Primary", "bg-primary text-primary-foreground", "Trust / main CTA"],
            ["Accent", "bg-accent text-accent-foreground", "Urgency / splits"],
            ["Secondary", "bg-secondary text-secondary-foreground", "Soft actions"],
            ["Muted", "bg-muted text-muted-foreground", "Subtle surfaces"],
            ["Card", "bg-card text-card-foreground border", "Surfaces"],
            ["Destructive", "bg-destructive text-destructive-foreground", "Danger only"],
          ].map(([name, cls, use]) => (
            <div key={name} className={`rounded-2xl p-4 ${cls}`}>
              <p className="font-bold">{name}</p>
              <p className="mt-1 text-xs opacity-80">{use}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Type */}
      <div className="mt-8">
        <SectionHeader title="Typography" sub="System stack (offline-safe). Tabular numerals for money." />
        <Card className="p-5">
          <p className="text-4xl font-extrabold tracking-tight">Okirika, without stories.</p>
          <p className="mt-2 text-xl font-bold">Live bale splits</p>
          <p className="mt-2 text-base">Body — verified bales from inspected vendors.</p>
          <p className="mt-2 text-sm text-muted-foreground">Small muted — delivery estimates, helper text.</p>
          <p className="mt-2 text-2xl font-extrabold tabular-nums">₦15,000 <span className="text-sm font-medium text-muted-foreground">tabular-nums</span></p>
        </Card>
      </div>

      {/* Buttons + badges */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader title="Buttons" />
          <Card className="flex flex-wrap items-center gap-2 p-5">
            <Button>Default</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </Card>
        </div>
        <div>
          <SectionHeader title="Badges" />
          <Card className="flex flex-wrap items-center gap-2 p-5">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="verified">Verified</Badge>
            <Badge variant="inspected">Inspected</Badge>
            <Badge variant="live">Live</Badge>
            <GradeBadge grade="A" />
            <GradeBadge grade="B" />
            <GradeBadge grade="C" />
            <Badge variant="amber">Promo</Badge>
            <Badge variant="muted">Muted</Badge>
            <Badge variant="outline">Outline</Badge>
          </Card>
        </div>
      </div>

      {/* Components */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <SectionHeader title="Cards, inputs, progress" />
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>Card description goes here.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Input placeholder="Search bales…" aria-label="Demo input" />
              <Progress value={70} />
              <Progress value={90} indicatorClassName="bg-red-500" />
              <Separator />
              <div className="flex items-center gap-2">
                <Stars value={4.5} />
                <span className="text-sm font-semibold">4.5</span>
              </div>
            </CardContent>
          </Card>
        </div>
        <div>
          <SectionHeader title="Avatars & product art" />
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2">
              <Avatar initials="AT" hue={160} size="lg" />
              <Avatar initials="KB" hue={210} />
              <Avatar initials="GA" hue={20} size="sm" />
              <Avatar initials="PH" hue={280} size="xs" />
            </div>
            <AvatarStack items={[{ initials: "AT" }, { initials: "KB" }, { initials: "GA" }, { initials: "PH" }, { initials: "YV" }, { initials: "OB" }]} />
            <div className="grid grid-cols-3 gap-2">
              <ProductArt hue={210} category="Bales" className="aspect-square w-full rounded-xl" iconClassName="h-8 w-8" />
              <ProductArt hue={160} category="Shoes" className="aspect-square w-full rounded-xl" iconClassName="h-8 w-8" />
              <ProductArt hue={300} category="Women" className="aspect-square w-full rounded-xl" iconClassName="h-8 w-8" />
            </div>
          </Card>
        </div>
      </div>

      {/* Rules */}
      <div className="mt-8 grid gap-6 pb-8 lg:grid-cols-2">
        <Card className="border-emerald-300 p-5">
          <h2 className="flex items-center gap-2 font-bold text-emerald-700"><Check className="h-5 w-5" /> Do</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>Trust signals above the fold on every listing (vendor, grade, escrow).</li>
            <li>44px+ touch targets, sticky buy bar on mobile detail pages.</li>
            <li>One primary CTA per screen. Urgency only where real (live splits).</li>
            <li>Tabular numerals for all prices and countdowns.</li>
          </ul>
        </Card>
        <Card className="border-red-300 p-5">
          <h2 className="flex items-center gap-2 font-bold text-red-700"><X className="h-5 w-5" /> Don&apos;t</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>No raw &lt;button&gt; or &lt;input&gt; — use shadcn primitives.</li>
            <li>No hardcoded hex colors — use semantic tokens.</li>
            <li>No fake urgency (invented stock, fake timers).</li>
            <li>No money logic in components — Edge Functions only.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
