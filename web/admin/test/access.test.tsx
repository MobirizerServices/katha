import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Access } from "../src/views/Access";
import { PERMISSION_MATRIX, ROLE_NAMES } from "../src/auth/roles";

describe("Access view — permission matrix", () => {
  it("renders a header for every role", () => {
    render(<Access />);
    for (const name of Object.values(ROLE_NAMES)) {
      expect(screen.getByRole("columnheader", { name })).toBeInTheDocument();
    }
  });

  it("renders every capability row", () => {
    render(<Access />);
    for (const row of PERMISSION_MATRIX) {
      expect(screen.getByText(row.cap)).toBeInTheDocument();
    }
  });

  it("renders yes as a check mark and no as a dash", () => {
    render(<Access />);
    // 'Analytics dashboards' row is 'yes' for every role -> all checks.
    const row = screen.getByText("Analytics dashboards").closest("tr")!;
    const marks = within(row).getAllByText("✓");
    expect(marks).toHaveLength(7);
  });

  it("shows a dash for a 'no' cell", () => {
    render(<Access />);
    // 'Finance imports & GST' — content(role idx1) is 'no'.
    const row = screen.getByText("Finance imports & GST").closest("tr")!;
    expect(within(row).getAllByText("–").length).toBeGreaterThan(0);
  });

  it("renders note strings verbatim", () => {
    render(<Access />);
    const row = screen.getByText("Coin adjustment > 500").closest("tr")!;
    expect(within(row).getByText("2 approvers")).toBeInTheDocument();
    expect(within(row).getByText("request")).toBeInTheDocument();
    expect(within(row).getByText("approve")).toBeInTheDocument();
  });
});
