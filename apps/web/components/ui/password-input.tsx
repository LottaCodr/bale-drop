"use client";

import * as React from "react";
import { Eye, EyeOff, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle.
 *
 * Accessibility + security choices (see docs/UX-RESEARCH.md → "Auth"):
 *  - The toggle is a real <button type="button"> (never submits the form),
 *    keyboard operable, 44×44px touch target, linked via aria-controls.
 *  - Its accessible name stays constant ("Show password") while
 *    `aria-pressed` carries the state — screen readers handle dynamic state
 *    far better than dynamic names. A polite live region announces the change.
 *  - Focus stays on the toggle and the caret position is preserved.
 *  - The value is re-masked automatically when the form submits, so browsers
 *    and password managers still recognise and offer to save it.
 *  - Caps Lock warning while typing — the #1 cause of "wrong password".
 *  - Paste is never blocked (NIST SP 800-63B).
 */
export interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Hide the Caps Lock hint (e.g. on very compact layouts). */
  hideCapsLockHint?: boolean;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, id, hideCapsLockHint, onKeyDown, onKeyUp, onBlur, disabled, ...props }, forwardedRef) => {
    const generatedId = React.useId();
    const inputId = id ?? `password-${generatedId}`;
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const [visible, setVisible] = React.useState(false);
    const [capsLock, setCapsLock] = React.useState(false);
    const [announcement, setAnnouncement] = React.useState("");

    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef]
    );

    // Re-mask on submit so the browser treats it as a password when saving.
    React.useEffect(() => {
      const form = innerRef.current?.form;
      if (!form) return;
      const mask = () => setVisible(false);
      form.addEventListener("submit", mask);
      return () => form.removeEventListener("submit", mask);
    }, []);

    function toggle() {
      const input = innerRef.current;
      const start = input?.selectionStart ?? null;
      const end = input?.selectionEnd ?? null;
      setVisible((current) => {
        const next = !current;
        setAnnouncement(next ? "Your password is shown." : "Your password is hidden.");
        return next;
      });
      // Restore the caret after React swaps the type attribute.
      requestAnimationFrame(() => {
        if (input && start !== null && end !== null && document.activeElement === input) {
          input.setSelectionRange(start, end);
        }
      });
    }

    function readCapsLock(event: React.KeyboardEvent<HTMLInputElement>) {
      if (typeof event.getModifierState === "function") setCapsLock(event.getModifierState("CapsLock"));
    }

    const capsId = `${inputId}-caps`;
    const describedBy = [props["aria-describedby"], capsLock && !hideCapsLockHint ? capsId : null].filter(Boolean).join(" ") || undefined;

    return (
      <div>
        <div className="relative">
          <input
            {...props}
            id={inputId}
            ref={setRefs}
            type={visible ? "text" : "password"}
            disabled={disabled}
            // Prevent mobile keyboards from "fixing" a visible password.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={describedBy}
            onKeyDown={(event) => {
              readCapsLock(event);
              onKeyDown?.(event);
            }}
            onKeyUp={(event) => {
              readCapsLock(event);
              onKeyUp?.(event);
            }}
            onBlur={(event) => {
              setCapsLock(false);
              onBlur?.(event);
            }}
            className={cn(
              "flex h-11 w-full rounded-xl border border-input bg-background py-2 pl-4 pr-12 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500",
              "[&::-ms-clear]:hidden [&::-ms-reveal]:hidden",
              className
            )}
          />
          <button
            type="button"
            onClick={toggle}
            disabled={disabled}
            aria-controls={inputId}
            aria-pressed={visible}
            aria-label="Show password"
            title={visible ? "Hide password" : "Show password"}
            className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            {visible ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
          </button>
        </div>
        {capsLock && !hideCapsLockHint && (
          <p id={capsId} className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" /> Caps Lock is on
          </p>
        )}
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
