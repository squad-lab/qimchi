import { describe, expect, it } from "vitest";

import {
  appearanceOverrides,
  FACTORY_APPEARANCE_SETTINGS,
  mergeAppearanceDefaults,
} from "./appearanceDefaults";

const withColorscale = (colorscale: string) => ({
  ...FACTORY_APPEARANCE_SETTINGS,
  hmap: { colorscale, rangecolor: null },
});

describe("appearance overrides", () => {
  it("records only what differs from the defaults", () => {
    const settings = {
      ...withColorscale("plasma"),
      x: {
        ...FACTORY_APPEARANCE_SETTINGS.x,
        maj: { ...FACTORY_APPEARANCE_SETTINGS.x.maj, showgrid: true },
      },
    };

    expect(appearanceOverrides(settings, FACTORY_APPEARANCE_SETTINGS)).toEqual({
      hmap: { colorscale: "plasma" },
      x: { maj: { showgrid: true } },
    });
  });

  it("lets a changed default reach a plot that did not override it", () => {
    const overrides = { x: { maj: { showgrid: true } } };

    const effective = mergeAppearanceDefaults(withColorscale("cividis"), overrides);

    expect(effective.hmap?.colorscale).toBe("cividis");
    expect(effective.x.maj.showgrid).toBe(true);
  });

  it("keeps a plot's own colour range, which has no default", () => {
    const overrides = { hmap: { rangecolor: [10, 90] } };

    expect(
      mergeAppearanceDefaults(FACTORY_APPEARANCE_SETTINGS, overrides).hmap?.rangecolor,
    ).toEqual([10, 90]);
  });
});
