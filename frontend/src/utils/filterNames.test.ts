import { describe, expect, it } from "vitest";

import { filterLabel } from "./filterNames";

describe("filterLabel", () => {
  it("shows the plot axis a derivative is taken along, not the array axis", () => {
    expect(filterLabel("diff_x")).toBe("Diff along Y");
    expect(filterLabel("diff_y")).toBe("Diff along X");
  });

  it("makes an unknown key readable instead of showing snake_case", () => {
    expect(filterLabel("some_new_filter")).toBe("Some new filter");
  });
});
