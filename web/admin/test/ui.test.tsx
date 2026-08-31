import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  fmtN,
  ago,
  tsLabel,
  StatusBadge,
  PageHeader,
  Poster,
  Modal,
} from "../src/ui";
import type { SeriesStatus } from "../src/api/types";

describe("fmtN", () => {
  it("formats numbers with the Indian grouping", () => {
    expect(fmtN(1300)).toBe("1,300");
    expect(fmtN(16000)).toBe("16,000");
    expect(fmtN(0)).toBe("0");
  });
});

describe("ago", () => {
  const NOW = 1_700_000_000_000;
  beforeEach(() => vi.setSystemTime(NOW));
  afterEach(() => vi.useRealTimers());

  it("returns 'just now' under a minute", () => {
    expect(ago(NOW - 30_000)).toBe("just now");
  });
  it("clamps future timestamps to 'just now'", () => {
    expect(ago(NOW + 100_000)).toBe("just now");
  });
  it("returns minutes", () => {
    expect(ago(NOW - 5 * 60_000)).toBe("5 min ago");
  });
  it("returns hours", () => {
    expect(ago(NOW - 3 * 3600_000)).toBe("3 h ago");
  });
  it("returns days", () => {
    expect(ago(NOW - 2 * 24 * 3600_000)).toBe("2 d ago");
  });
});

describe("tsLabel", () => {
  it("renders an ISO-ish UTC label", () => {
    const ts = Date.UTC(2026, 7, 31, 6, 0, 0);
    expect(tsLabel(ts)).toBe("2026-08-31 06:00:00Z");
  });
});

describe("StatusBadge", () => {
  const cases: [SeriesStatus, string][] = [
    ["live", "Live"],
    ["sched", "Scheduled"],
    ["qc", "In QC"],
    ["draft", "Draft"],
    ["arch", "Archived"],
  ];
  it.each(cases)("renders %s as %s with a status class", (status, label) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector(`.st-${status}`)).toBeTruthy();
  });
});

describe("PageHeader", () => {
  it("renders title only", () => {
    render(<PageHeader title="Catalog" />);
    expect(screen.getByRole("heading", { name: "Catalog" })).toBeInTheDocument();
  });
  it("renders subtitle, crumbs and actions when provided", () => {
    render(
      <PageHeader
        title="Users"
        subtitle="sub"
        crumbs={<span>home</span>}
        actions={<button>act</button>}
      />
    );
    expect(screen.getByText("sub")).toBeInTheDocument();
    expect(screen.getByText("home")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "act" })).toBeInTheDocument();
  });
});

describe("Poster", () => {
  it("cycles palette by index (modulo)", () => {
    const { container } = render(<Poster i={0} />);
    const el = container.querySelector(".pos") as HTMLElement;
    expect(el.style.getPropertyValue("--c1")).toBe("#8A4A2F");
  });
  it("wraps around past the palette length", () => {
    const { container } = render(<Poster i={6} />);
    const el = container.querySelector(".pos") as HTMLElement;
    expect(el.style.getPropertyValue("--c1")).toBe("#8A4A2F");
  });
});

describe("Modal", () => {
  it("renders title, children, footer and closes on scrim click", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="Adjust" footer={<button>ok</button>} onClose={onClose}>
        <p>body</p>
      </Modal>
    );
    expect(screen.getByRole("dialog", { name: "Adjust" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ok" })).toBeInTheDocument();
    fireEvent.click(container.querySelector(".scrim")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
