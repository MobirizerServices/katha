import { describe, it, expect } from "vitest";
import { LANGUAGES, SERIES, allGenres, filterSeries, languageName, maskPhone, metaLine } from "@/lib/catalog";

describe("languageName / LANGUAGES", () => {
  it("maps the launch codes and passes unknown codes through", () => {
    expect(languageName("hi")).toBe("Hindi");
    expect(languageName("ta")).toBe("Tamil");
    expect(languageName("te")).toBe("Telugu");
    expect(languageName("bho")).toBe("bho");
    expect(LANGUAGES.map((l) => l.code)).toEqual(["hi", "ta", "te"]);
  });
});

describe("allGenres / filterSeries", () => {
  const rows = [
    { slug: "a", genres: ["Romance", "Revenge"], language: "Hindi" },
    { slug: "b", genres: ["Thriller/Crime"], language: "Tamil" },
    { slug: "c", genres: ["Romance"], language: "Tamil" },
    { slug: "d", genres: [], language: "Telugu" },
  ];
  it("lists every genre once, sorted", () => {
    expect(allGenres(rows)).toEqual(["Revenge", "Romance", "Thriller/Crime"]);
    expect(allGenres(SERIES).length).toBeGreaterThan(3);
  });
  it("filters by genre and language together; empty filters keep everything", () => {
    expect(filterSeries(rows, {}).map((r) => r.slug)).toEqual(["a", "b", "c", "d"]);
    expect(filterSeries(rows, { genre: "Romance" }).map((r) => r.slug)).toEqual(["a", "c"]);
    expect(filterSeries(rows, { lang: "Tamil" }).map((r) => r.slug)).toEqual(["b", "c"]);
    expect(filterSeries(rows, { genre: "Romance", lang: "Tamil" }).map((r) => r.slug)).toEqual(["c"]);
    expect(filterSeries(rows, { genre: "Horror", lang: null })).toEqual([]);
  });
});

describe("metaLine", () => {
  it("joins language · genre · episodes and skips a missing genre", () => {
    expect(metaLine("Hindi", "Romance", 60)).toBe("Hindi · Romance · 60 episodes");
    expect(metaLine("Tamil", undefined, 12)).toBe("Tamil · 12 episodes");
  });
});

describe("maskPhone", () => {
  it("hides the three digits before the last two and keeps the formatting", () => {
    expect(maskPhone("+91 98765 43210")).toBe("+91 98765 •••10");
    expect(maskPhone("+91 98765 43221")).toBe("+91 98765 •••21");
    expect(maskPhone("9876543210")).toBe("98765•••10");
    expect(maskPhone("+1 (415) 555-0199")).toBe("+1 (415) 55•-••99");
    expect(maskPhone("12")).toBe("12");
    expect(maskPhone("")).toBe("");
  });
});
