import { useEffect, useRef } from "react";
import { driver, type Driver, type PopoverDOM } from "driver.js";
import "driver.js/dist/driver.css";
import "./walkthrough.css";

import { getSettings } from "../services/settingsAPI";
import { resolveSettings } from "../settings/userSettings";
import { useSettingsStore } from "../stores/settingsStore";
import { WALKTHROUGH_STEPS, closingCard, putThingsBack, type StepContext } from "./steps";
import { useWalkthroughStore } from "./walkthroughStore";

const POLL_MS = 400;
// Maximum time to wait for a target before showing an untargeted card.
const TARGET_WAIT_MS = 3000;

const context = (): StepContext => {
  const state = useWalkthroughStore.getState();
  return {
    demo: state.demo,
    live: state.live,
    bridge: state.bridge,
    setDemo: state.setDemo,
    setLive: state.setLive,
    previousExplorer: state.previousExplorer,
    setPreviousExplorer: state.setPreviousExplorer,
  };
};

// Open things that Esc closes first
const ESCAPE_TAKERS = [
  "[data-closes-on-escape]",
  // The tour's own card is a dialog too.
  "[role='dialog']:not(#driver-popover-content)",
  "[data-qimchi-popup]",
  "[data-tour='filters-panel']",
  "[data-tour='appearance-panel']",
  "[aria-haspopup='menu'][aria-expanded='true']",
  "[aria-label='Exit full window'][aria-pressed='true']",
].join(",");

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

const errorText = (error: unknown) => {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return error instanceof Error ? error.message : "Something went wrong.";
};

/** Runs the target-driven walkthrough and offers it once on first launch. */
const Walkthrough = () => {
  const active = useWalkthroughStore((state) => state.active);
  const stepIndex = useWalkthroughStore((state) => state.stepIndex);
  const closing = useWalkthroughStore((state) => state.closing);
  const paused = useWalkthroughStore((state) => state.paused);
  const driverRef = useRef<Driver | null>(null);
  // Track initialized steps to avoid rerunning `enter` after a pause.
  const enteredStepRef = useRef<number | null>(null);

  // Do not auto-start in automated browsers; end-to-end tests start it explicitly.
  useEffect(() => {
    if (navigator.webdriver) return;
    let cancelled = false;
    getSettings()
      .then(({ settings }) => {
        if (!cancelled && !resolveSettings(settings).general.walkthroughSeen) {
          useWalkthroughStore.getState().start();
        }
      })
      .catch(() => {
        // If settings cannot be loaded, leave the walkthrough closed.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Axes left in the Composer would stop its steps from being completed.
  useEffect(() => {
    if (active) useWalkthroughStore.getState().bridge.clearComposer?.();
  }, [active]);

  useEffect(() => {
    if (active && !useSettingsStore.getState().settings.general.walkthroughSeen) {
      useSettingsStore.getState().update(["general", "walkthroughSeen"], true);
    }
  }, [active]);

  useEffect(() => {
    if (!active) enteredStepRef.current = null;
    // Remove the overlay while Help or Settings is open.
    if (!active || paused) {
      driverRef.current?.destroy();
      driverRef.current = null;
      return;
    }

    if (!driverRef.current) {
      driverRef.current = driver({
        animate: true,
        overlayOpacity: 0.45,
        stagePadding: 6,
        stageRadius: 8,
        allowClose: true,
        allowKeyboardControl: false,
        // Require navigation through the card controls.
        overlayClickBehavior: () => {},
        popoverClass: "qimchi-walkthrough",
      });
    }
    const tour = driverRef.current;
    const { goTo, back, stop, requestClose } = useWalkthroughStore.getState();

    if (closing) {
      const card = closingCard(context());
      tour.highlight({
        popover: {
          popoverClass: "qimchi-walkthrough qimchi-walkthrough-enter",
          title: card.title,
          description: card.body,
          showButtons: ["next", "previous", "close"],
          nextBtnText: "Tidy up",
          prevBtnText: "Keep everything",
          onNextClick: () => {
            putThingsBack(context());
            stop();
          },
          onPrevClick: () => stop(),
          onCloseClick: () => stop(),
        },
      });
      return;
    }

    const step = WALKTHROUGH_STEPS[stepIndex];
    if (!step) {
      stop();
      return;
    }
    const isLast = stepIndex === WALKTHROUGH_STEPS.length - 1;

    let disposed = false;
    let busy = false;
    let error: string | null = null;
    let shownTarget: Element | null | undefined = undefined;
    const stepStartedAt = Date.now();
    // Enable Next only after the task is complete and its target is present.
    let ready = false;
    const isReady = (target: Element | null) => {
      if (step.next === "action") return true;
      const ctx = context();
      return (!step.done || step.done(ctx)) && (!step.target || target !== null);
    };
    // Auto-advance only after observing this step transition from incomplete to complete.
    let seenUndone = false;

    const advance = () => (isLast ? requestClose() : goTo(stepIndex + 1));

    // Update buttons in place to avoid reflowing the entire card.
    let card: PopoverDOM | null = null;
    let actionButton: HTMLButtonElement | null = null;
    const runsAction = step.next === "action";
    const nextLabel = runsAction ? (step.action?.label ?? "Next") : (step.next ?? "Next");
    const updateButtons = () => {
      if (!card) return;
      const blocked = busy || !ready;
      card.nextButton.disabled = blocked;
      card.nextButton.classList.toggle("driver-popover-btn-disabled", blocked);
      card.nextButton.textContent = busy ? "Just a moment..." : nextLabel;
      if (actionButton) actionButton.disabled = busy;
    };

    const runAction = async (thenAdvance: boolean) => {
      if (!step.action || busy) return;
      // Treat an invoked action as the step's incomplete-to-complete transition.
      seenUndone = true;
      busy = true;
      const hadError = error !== null;
      error = null;
      if (hadError) render(shownTarget ?? null);
      else updateButtons();
      try {
        await step.action.run(context());
        if (disposed) return;
        busy = false;
        if (thenAdvance) advance();
        else updateButtons();
      } catch (caught) {
        if (disposed) return;
        busy = false;
        error = errorText(caught);
        render(shownTarget ?? null);
      }
    };

    // Apply the entry animation only on the first render of a step.
    let entered = false;
    const render = (target: Element | null) => {
      const popoverClass = [
        "qimchi-walkthrough",
        step.wide ? "qimchi-walkthrough-wide" : "",
        entered ? "" : "qimchi-walkthrough-enter",
      ]
        .filter(Boolean)
        .join(" ");
      entered = true;
      const note = error
        ? `<p class="qimchi-walkthrough-error">${error.replace(/</g, "&lt;")}</p>`
        : "";
      tour.highlight({
        element: target ?? undefined,
        popover: {
          popoverClass,
          title: step.title,
          description: step.body(context()) + note,
          side: target ? step.side : undefined,
          align: "center",
          showButtons: stepIndex === 0 ? ["next", "close"] : ["next", "previous", "close"],
          disableButtons: busy || !ready ? ["next"] : [],
          showProgress: true,
          progressText: `${stepIndex + 1} of ${WALKTHROUGH_STEPS.length}`,
          nextBtnText: busy ? "Just a moment..." : nextLabel,
          prevBtnText: "Back",
          onNextClick: () => {
            if (runsAction) void runAction(true);
            else advance();
          },
          onPrevClick: () => back(),
          onCloseClick: () => requestClose(),
          onPopoverRender: (popover) => {
            card = popover;
            actionButton = null;
            if (!step.action || runsAction) return;
            const button = document.createElement("button");
            button.className = "driver-popover-footer-btn qimchi-walkthrough-action";
            button.textContent = step.action.label;
            button.disabled = busy;
            button.addEventListener("click", () => void runAction(false));
            popover.footer.prepend(button);
            actionButton = button;
          },
        },
      });
    };

    const tick = () => {
      if (disposed) return;
      const ctx = context();
      if (!busy) step.repair?.(ctx);
      if (!busy && step.done) {
        if (!step.done(ctx)) {
          seenUndone = true;
        } else if (seenUndone) {
          advance();
          return;
        }
      }
      const target = step.target?.(ctx) ?? null;
      // Delay the untargeted fallback briefly while the target mounts.
      const waiting =
        step.target &&
        target === null &&
        shownTarget === undefined &&
        Date.now() - stepStartedAt < TARGET_WAIT_MS;
      if (waiting) {
        document
          .querySelector<HTMLElement>(".driver-popover")
          ?.style.setProperty("visibility", "hidden");
        return;
      }
      const nowReady = isReady(target);
      if (target !== shownTarget) {
        shownTarget = target;
        ready = nowReady;
        render(target);
      } else if (nowReady !== ready) {
        ready = nowReady;
        updateButtons();
      } else {
        // Recalculate the highlight after target layout changes.
        tour.refresh();
      }
    };

    void (async () => {
      try {
        if (useWalkthroughStore.getState().cameBack) {
          useWalkthroughStore.getState().clearCameBack();
          step.back?.(context());
        }
        if (enteredStepRef.current !== stepIndex) {
          enteredStepRef.current = stepIndex;
          await step.enter?.(context());
        }
      } catch (caught) {
        error = errorText(caught);
      }
      tick();
    })();
    const timer = window.setInterval(tick, POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [active, stepIndex, closing, paused]);

  useEffect(() => {
    if (!active || paused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat || isEditable(event.target)) return;
      // Checked before anything else handles this Esc and closes itself.
      if (document.querySelector(ESCAPE_TAKERS)) return;
      const { closing, requestClose, stop } = useWalkthroughStore.getState();
      // A second Esc on the tidy-up question keeps everything.
      if (closing) stop();
      else requestClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, paused]);

  useEffect(
    () => () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    },
    [],
  );

  return null;
};

export default Walkthrough;
