"use client";

import { Moon, Sun, SunMoon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePrefsStore, type ThemeChoice } from "@/lib/store/prefs-store";
import { useHasMounted } from "@/lib/store/hooks";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = {
  system: "Theme: follow device",
  light: "Theme: light",
  dark: "Theme: dark",
};

/**
 * Theme control. The dark palette has been in globals.css since day one; this
 * connects it to `prefs.theme`, with an inlined bootstrap script in the layout
 * so there is no light→dark flash on load.
 */
export function ThemeToggle() {
  const theme = usePrefsStore((state) => state.theme);
  const setTheme = usePrefsStore((state) => state.setTheme);
  const mounted = useHasMounted();
  const current: ThemeChoice = mounted ? theme : "system";
  const Icon = current === "dark" ? Moon : current === "light" ? Sun : SunMoon;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={LABEL[current]}
      title={LABEL[current]}
      onClick={() => setTheme(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? "system")}
    >
      <Icon className="h-5 w-5" />
    </Button>
  );
}
