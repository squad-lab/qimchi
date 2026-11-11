import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGlobalShortcutsInit, useShortcut, type ShortcutAction } from "./useGlobalShortcuts";

const listen = (action: ShortcutAction) => {
  const callback = vi.fn();
  renderHook(() => useShortcut(action, callback));
  return callback;
};

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

describe("scoped shortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const basket = () => {
    const list = document.createElement("div");
    list.tabIndex = 0;
    list.dataset.shortcutScope = "basket";
    const button = document.createElement("button");
    list.appendChild(button);
    document.body.appendChild(list);
    return { list, button };
  };

  it("fire only while focus is on their scope", () => {
    renderHook(() => useGlobalShortcutsInit());
    const next = listen("basket-next");
    const { list, button } = basket();

    press(document.body, "ArrowRight");
    press(button, "ArrowRight");
    expect(next).not.toHaveBeenCalled();

    press(list, "ArrowRight");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("take Ctrl only inside their scope, leaving other shortcuts as they were", () => {
    renderHook(() => useGlobalShortcutsInit());
    const selectAll = listen("basket-select-all");
    const appearance = listen("selected-open-appearance");
    const { list } = basket();

    press(document.body, "a", { ctrlKey: true });
    expect(selectAll).not.toHaveBeenCalled();
    expect(appearance).not.toHaveBeenCalled();

    press(list, "a", { metaKey: true });
    expect(selectAll).toHaveBeenCalledTimes(1);

    press(list, "a");
    expect(appearance).toHaveBeenCalledTimes(1);
  });

  it("repeat only where asked to", () => {
    renderHook(() => useGlobalShortcutsInit());
    const extend = listen("basket-extend-next");
    const plot = listen("plot");
    const { list } = basket();

    press(list, "ArrowRight", { shiftKey: true, repeat: true });
    press(list, "p", { repeat: true });

    expect(extend).toHaveBeenCalledTimes(1);
    expect(plot).not.toHaveBeenCalled();
  });
});

describe("dataset cycling", () => {
  it("needs Alt, leaving bare arrows to the tree and LineCut markers", () => {
    renderHook(() => useGlobalShortcutsInit());
    const previous = listen("dataset-previous");
    const next = listen("dataset-next");

    press(document.body, "ArrowUp");
    press(document.body, "ArrowDown");
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();

    press(document.body, "ArrowUp", { altKey: true });
    press(document.body, "ArrowDown", { altKey: true });
    expect(previous).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
