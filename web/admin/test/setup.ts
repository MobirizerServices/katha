import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { __resetApiCache } from "../src/api/client";

afterEach(() => {
  cleanup();
  __resetApiCache();
});
