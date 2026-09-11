import { beforeEach, describe, expect, it } from "vitest";

import { useSidebarStore } from "./sidebarStore";

const initial = useSidebarStore.getState();

const reset = () => {
  useSidebarStore.setState({
    ...initial,
    activeSection: "explorer",
    explorerCollapsed: false,
    metadataCollapsed: true,
    notesCollapsed: true,
    sidebarCollapsed: false,
    explorerExpanded: false,
  });
};

describe("accordion sections", () => {
  beforeEach(reset);

  it("shows exactly one section at a time", () => {
    useSidebarStore.getState().setActiveSection("notes");
    const state = useSidebarStore.getState();

    expect(state.activeSection).toBe("notes");
    expect(state.notesCollapsed).toBe(false);
    expect(state.metadataCollapsed).toBe(true);
    expect(state.explorerCollapsed).toBe(true);
  });

  it("opening a section reveals the sidebar body", () => {
    useSidebarStore.setState({ sidebarCollapsed: true });

    useSidebarStore.getState().setActiveSection("metadata");

    expect(useSidebarStore.getState().sidebarCollapsed).toBe(false);
  });

  it("treats Live as the Explorer in live mode", () => {
    useSidebarStore.getState().setActiveSection("live");
    const state = useSidebarStore.getState();

    // One tree, one poller: Live is the Explorer pane with the flag set.
    expect(state.componentStates.dirTree.showLiveOnly).toBe(true);
    expect(state.explorerCollapsed).toBe(false);

    useSidebarStore.getState().setActiveSection("explorer");
    expect(useSidebarStore.getState().componentStates.dirTree.showLiveOnly).toBe(false);
  });

  it("leaves the live flag alone for sections that are not the Explorer", () => {
    useSidebarStore.getState().setActiveSection("live");
    useSidebarStore.getState().setActiveSection("notes");

    expect(useSidebarStore.getState().componentStates.dirTree.showLiveOnly).toBe(true);
  });

  it("keeps the legacy collapse setters in step with activeSection", () => {
    useSidebarStore.getState().setNotesCollapsed(false);
    expect(useSidebarStore.getState().activeSection).toBe("notes");

    // Collapsing the open section hides the body rather than leaving an
    // empty pane with nothing selected.
    useSidebarStore.getState().setNotesCollapsed(true);
    expect(useSidebarStore.getState().activeSection).toBe(null);
  });
});

describe("full-window Explorer", () => {
  beforeEach(reset);

  it("expanding implies the Explorer is showing", () => {
    useSidebarStore.setState({ activeSection: "notes", sidebarCollapsed: true });

    useSidebarStore.getState().setExplorerExpanded(true);
    const state = useSidebarStore.getState();

    expect(state.explorerExpanded).toBe(true);
    expect(state.activeSection).toBe("explorer");
    expect(state.sidebarCollapsed).toBe(false);
  });

  it("keeps Live expanded rather than dropping back to Explorer", () => {
    useSidebarStore.getState().setActiveSection("live");

    useSidebarStore.getState().setExplorerExpanded(true);

    expect(useSidebarStore.getState().activeSection).toBe("live");
  });

  it("collapsing the sidebar leaves the full-window view", () => {
    useSidebarStore.getState().setExplorerExpanded(true);

    // Otherwise the overlay is hidden but still covering the rail, and there
    // is no way back to it.
    useSidebarStore.getState().setSidebarCollapsed(true);

    expect(useSidebarStore.getState().explorerExpanded).toBe(false);
  });

  it("switching to another section leaves it too", () => {
    useSidebarStore.getState().setExplorerExpanded(true);

    useSidebarStore.getState().setActiveSection("metadata");

    expect(useSidebarStore.getState().explorerExpanded).toBe(false);
  });
});

describe("persisted defaults", () => {
  it("opens the Explorer newest-first", () => {
    expect(initial.componentStates.dirTree.sortBy).toBe("timestamp");
    expect(initial.componentStates.dirTree.sortDirection).toBe("desc");
  });

  it("starts with nothing expanded, so the tree loads collapsed", () => {
    expect(initial.componentStates.dirTree.expandedNodeIds).toEqual([]);
  });

  it("starts at 100% zoom with Basket and Composer open", () => {
    expect(initial.zoomLevel).toBe(1);
    expect(initial.basketCollapsed).toBe(false);
    expect(initial.composerCollapsed).toBe(false);
  });
});
